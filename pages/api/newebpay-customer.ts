// /pages/api/newebpay-customer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";

export const config = { api: { bodyParser: false } };

const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV  = "PKetlaZYZcZvlMmC";

const WC_API_BASE = "https://fegoesim.com/wp-json/wc/v3";
const WC_CK = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_CS = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

/* ---------------- utils ---------------- */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function sha(encrypted: string, key: string, iv: string) {
  const s = `HashKey=${key}&${encrypted}&HashIV=${iv}`;
  return crypto.createHash("sha256").update(s).digest("hex").toUpperCase();
}

/** 官方：AES-256-CBC + PKCS7，密文為 hex */
function aes256cbcDecryptHexPkcs7(hex: string, key: string, iv: string): string {
  const encrypted = Buffer.from(hex.trim(), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher.setAutoPadding(false); // 手動去 PKCS7
  const buf = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 16) throw new Error(`Invalid PKCS7 padding length: ${pad}`);
  return buf.slice(0, buf.length - pad).toString("utf8");
}

/** Result 可能是 JSON 或 querystring；且 Result 可能再包一層字串 */
function parseDecrypted(text: string): any {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.Result === "string") {
      try { obj.Result = JSON.parse(obj.Result); }
      catch { obj.Result = qs.parse(obj.Result); }
    }
    return obj;
  } catch {
    const r = qs.parse(text);
    if ((r as any).Result && typeof (r as any).Result === "string") {
      try { (r as any).Result = JSON.parse((r as any).Result as string); }
      catch { (r as any).Result = qs.parse((r as any).Result as string); }
    }
    return r;
  }
}

/** 只做 URL 層級的「還原」候選（不做 base64 亂試），以便找出能過 SHA 的原字串 */
function buildTradeInfoCandidates(tiRaw: string): string[] {
  const out = new Set<string>();
  const push = (s?: string) => { if (s && s.trim()) out.add(String(s).trim()); };

  const raw = String(tiRaw || "").trim();
  push(raw);

  // 有 %xx 再 decode 一次（避免過度 decode）
  if (/%[0-9a-fA-F]{2}/.test(raw)) {
    try { push(decodeURIComponent(raw)); } catch {}
  }

  // 處理 + 被轉空白的情形：空白→+，然後再嘗試 decode
  if (!/%[0-9a-fA-F]{2}/.test(raw) && /\s/.test(raw)) {
    const restored = raw.replace(/\s+/g, "+");
    push(restored);
    try { push(decodeURIComponent(restored)); } catch {}
  }

  // 特殊：%2B → +
  const plusFixed = raw.replace(/%2B/gi, "+");
  if (plusFixed !== raw) {
    push(plusFixed);
    try { push(decodeURIComponent(plusFixed)); } catch {}
  }

  return Array.from(out);
}

function isOffsitePending(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  return t === "VACC" || t === "CVS" || t === "WEBATM";
}
function buildOffsiteInfo(result: any) {
  return {
    PaymentType: String(result?.PaymentType || "").toUpperCase(),
    BankCode:    result?.BankCode || result?.BankNo || result?.PayBankCode || "",
    CodeNo:      result?.CodeNo || result?.ATMAccNo || result?.PaymentNo || result?.PayerAccount5Code || "",
    PaymentNo:   result?.PaymentNo || "",
    StoreType:   result?.StoreType || "",
    ExpireDate:  result?.ExpireDate || result?.ExpireTime || "",
    TradeNo:     result?.TradeNo || "",
    Amt:         result?.Amt,
  };
}
async function findWooOrderIdByNewebpayNo(merchantOrderNo: string): Promise<number | null> {
  const resp = await axios.get(`${WC_API_BASE}/orders`, {
    auth: { username: WC_CK, password: WC_CS },
    params: { per_page: 50, orderby: "date", order: "desc" },
  });
  const orders = resp.data || [];
  for (const o of orders) {
    const hit = (o.meta_data || []).some(
      (m: any) => m?.key === "newebpay_order_no" && m?.value === merchantOrderNo
    );
    if (hit) return Number(o.id);
  }
  return null;
}

/* ---------------- handler ---------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rid = Math.random().toString(36).slice(2, 10);

  if (req.method !== "POST") {
    res.writeHead(302, { Location: "/" }).end();
    return;
  }

  try {
    const raw = await readBody(req);

    // 先從 query 取保底的 orderNo
    const queryOrderNo =
      Array.isArray(req.query.orderNo) ? req.query.orderNo[0] : (req.query.orderNo as string | undefined) || "";

    // 從 raw 抽參數（避免被任何 parser 改掉內容）
    const getRaw = (name: string): string => {
      const i = raw.indexOf(`${name}=`);
      if (i < 0) return "";
      const s = i + name.length + 1;
      const e = raw.indexOf("&", s);
      return (e === -1 ? raw.slice(s) : raw.slice(s, e)).trim();
    };
    const TI_raw = getRaw("TradeInfo");
    const TS_raw = getRaw("TradeSha");

    // 只做 URL 邏輯修復的候選，找出能「通過 SHA」的版本
    const candidates = buildTradeInfoCandidates(TI_raw);
    let matchedTI = "";
    for (const cand of candidates) {
      if (sha(cand, HASH_KEY, HASH_IV) === TS_raw) { matchedTI = cand; break; }
    }
    const shaOk = Boolean(matchedTI);

    // 先準備 orderNo（即便解不開也能對到 Woo）
    // 有些情況 MerchantOrderNo 也會出現在未加密欄位上（很少見），順手撈一下
    let orderNo = queryOrderNo
      || (raw.match(/(?:^|&)MerchantOrderNo=([^&]+)/)?.[1] ? decodeURIComponent(raw.match(/(?:^|&)MerchantOrderNo=([^&]+)/)![1]) : "")
      || "";

    // 嘗試解密（官方規格：hex + 手動 PKCS7）
    let result: any = null;
    let decryptErr: string | null = null;
    if (shaOk) {
      try {
        const decrypted = aes256cbcDecryptHexPkcs7(matchedTI, HASH_KEY, HASH_IV);
        const payload = parseDecrypted(decrypted);
        result = payload?.Result ?? null;
        if (result?.MerchantOrderNo) orderNo = String(result.MerchantOrderNo) || orderNo;
      } catch (e: any) {
        decryptErr = e?.message || String(e);
      }
    }

    // 沒拿到 orderNo → 無法對 Woo；直接回 /pending（讓前端顯示缺少參數）
    if (!orderNo) {
      console.warn(`[customer:${rid}] missing orderNo, shaOk=${shaOk}, tiLen=${(matchedTI || TI_raw).length}`);
      return res.writeHead(302, { Location: `/pending` }).end();
    }

    // 映射 Woo 訂單
    const wooOrderId = await findWooOrderIdByNewebpayNo(orderNo);
    if (!wooOrderId) {
      console.warn(`[customer:${rid}] cannot map Woo order for ${orderNo}`);
      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}&refresh=1` }).end();
    }

    // 若解不開或 sha 不過 → 在正確的訂單上寫 DEBUG，且仍導回 pending?orderNo=...
    if (!shaOk || !result) {
      try {
        await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
          {
            note: [
              `🧪 [DEBUG] Newebpay Customer (reqId=${rid})`,
              `shaOk=${shaOk}`,
              `tiLen=${(matchedTI || TI_raw).length}`,
              decryptErr ? `error=${decryptErr}` : "",
            ].filter(Boolean).join("\n"),
            customer_note: false,
          },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      } catch (e) {
        console.warn(`[customer:${rid}] write debug note failed: ${(e as any)?.message || e}`);
      }
      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}&refresh=1` }).end();
    }

    // 取號成功（ATM/超商/WebATM）→ on-hold + meta + 備註（冪等）
    if (isOffsitePending(result)) {
      const offsite = buildOffsiteInfo(result);

      await axios.put(`${WC_API_BASE}/orders/${wooOrderId}`, {
        status: "on-hold",
        meta_data: [
          { key: "newebpay_offsite_info", value: JSON.stringify(offsite) },
          { key: "newebpay_payment_type", value: offsite.PaymentType },
          { key: "newebpay_expire_date",  value: String(offsite?.ExpireDate || "") },
          { key: "newebpay_code_no",      value: String(offsite?.CodeNo || offsite?.PaymentNo || "") },
          { key: "newebpay_bank_code",    value: String(offsite?.BankCode || "") },
        ],
      }, { auth: { username: WC_CK, password: WC_CS } });

      // 防重複備註
      const { data: current } = await axios.get(`${WC_API_BASE}/orders/${wooOrderId}`, {
        auth: { username: WC_CK, password: WC_CS },
      });
      const alreadyNoted = (current?.meta_data || []).some((m: any) => m?.key === "newebpay_offsite_note_v1");

      if (!alreadyNoted) {
        const lines = [
          `🔔 藍新金流 取號成功（${offsite.PaymentType}）`,
          offsite.BankCode ? `銀行代碼：${offsite.BankCode}` : "",
          (offsite.CodeNo || offsite.PaymentNo) ? `轉帳帳號 / 繳費代碼：${offsite.CodeNo || offsite.PaymentNo}` : "",
          offsite.StoreType ? `超商別：${offsite.StoreType}` : "",
          offsite.ExpireDate ? `繳費期限：${offsite.ExpireDate}` : "",
          offsite.TradeNo ? `交易序號：${offsite.TradeNo}` : "",
          `商店訂單號：${orderNo}`,
          "（CustomerURL 寫入）",
        ].filter(Boolean).join("\n");

        await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
          { note: lines, customer_note: false },
          { auth: { username: WC_CK, password: WC_CS } }
        );
        await axios.put(`${WC_API_BASE}/orders/${wooOrderId}`,
          { meta_data: [{ key: "newebpay_offsite_note_v1", value: "1" }] },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      }
    }

    // 無論如何都導回 pending?orderNo=...
    return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}` }).end();

  } catch (e: any) {
    console.error(`[customer] error:`, e?.message || e);
    return res.writeHead(302, { Location: `/pending` }).end();
  }
}
