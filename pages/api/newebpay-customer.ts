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

/** AES-256-CBC + 手動 PKCS7 去 padding（輸入：Buffer 密文） */
function aes256cbcDecryptRawPkcs7(encBuf: Buffer, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8")
  );
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(encBuf), decipher.final()]);
  const pad = out[out.length - 1];
  if (pad < 1 || pad > 16) throw new Error(`Invalid PKCS7 padding length: ${pad}`);
  return out.slice(0, out.length - pad).toString("utf8");
}

/** 嘗試依序解密：HEX → BASE64（含 base64url 容錯） */
function decryptTradeInfoStrict(encrypted: string, key: string, iv: string): { plaintext: string, mode: "hex"|"base64" } {
  const ti = String(encrypted || "").trim();

  // 1) HEX（官方宣稱的標準）
  if (/^[0-9a-fA-F]+$/.test(ti) && ti.length % 2 === 0) {
    try {
      const buf = Buffer.from(ti, "hex");
      const plain = aes256cbcDecryptRawPkcs7(buf, key, iv);
      return { plaintext: plain, mode: "hex" };
    } catch (e) {
      // 繼續嘗試 base64
    }
  }

  // 2) BASE64（含空白->+、base64url -_/ → +/）
  const norm = ti.replace(/\s+/g, "+").replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "===".slice((norm.length + 3) % 4);
  try {
    const buf = Buffer.from(padded, "base64");
    if (buf.length > 0) {
      const plain = aes256cbcDecryptRawPkcs7(buf, key, iv);
      return { plaintext: plain, mode: "base64" };
    }
  } catch (e) {
    // 仍失敗，往外丟
  }

  throw new Error("Unsupported TradeInfo encoding after SHA pass");
}

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

    // 從 raw 擷取參數（避免被 parser 動到內容）
    const getRaw = (name: string): string => {
      const i = raw.indexOf(`${name}=`);
      if (i < 0) return "";
      const s = i + name.length + 1;
      const e = raw.indexOf("&", s);
      return (e === -1 ? raw.slice(s) : raw.slice(s, e)).trim();
    };
    const TI_raw = getRaw("TradeInfo");
    const TS_raw = getRaw("TradeSha");

    // query 保底 orderNo
    let orderNo =
      (Array.isArray(req.query.orderNo) ? req.query.orderNo[0] : (req.query.orderNo as string | undefined)) || "";

    // 先驗章（以目前收到的 TradeInfo 原文驗）
    const shaOk = TI_raw && sha(TI_raw, HASH_KEY, HASH_IV) === TS_raw;

    // 解密（只在 shaOk 時才做）
    let result: any = null;
    let decryptError: string | null = null;
    let decodeMode: "hex" | "base64" | "" = "";
    if (shaOk) {
      try {
        const { plaintext, mode } = decryptTradeInfoStrict(TI_raw, HASH_KEY, HASH_IV);
        decodeMode = mode;
        const payload = parseDecrypted(plaintext);
        result = payload?.Result ?? null;
        if (result?.MerchantOrderNo) orderNo = String(result.MerchantOrderNo) || orderNo;
      } catch (e: any) {
        decryptError = e?.message || String(e);
      }
    }

    // 沒拿到 orderNo → 直接回 /pending（讓前端顯示缺少參數）
    if (!orderNo) {
      console.warn(`[customer:${rid}] missing orderNo, shaOk=${shaOk}, tiLen=${TI_raw.length}`);
      return res.writeHead(302, { Location: `/pending` }).end();
    }

    // 對應 Woo 訂單
    const wooOrderId = await findWooOrderIdByNewebpayNo(orderNo);
    if (!wooOrderId) {
      console.warn(`[customer:${rid}] cannot map Woo order for ${orderNo}`);
      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}&refresh=1` }).end();
    }

    // 解不開 or sha 不過 → 在正確訂單上留下 DEBUG
    if (!shaOk || !result) {
      try {
        await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
          {
            note: [
              `🧪 [DEBUG] Newebpay Customer (reqId=${rid})`,
              `shaOk=${shaOk}`,
              `tiLen=${TI_raw.length}`,
              decodeMode ? `decodeMode=${decodeMode}` : "",
              decryptError ? `error=${decryptError}` : "",
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

    // 取號成功 → on-hold + meta + 備註（冪等）
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

    // 一律導回 pending?orderNo=...
    return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}` }).end();

  } catch (e: any) {
    console.error(`[customer] error:`, e?.message || e);
    return res.writeHead(302, { Location: `/pending` }).end();
  }
}
