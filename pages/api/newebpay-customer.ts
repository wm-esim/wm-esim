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

/** 先嘗試 HEX -> autoPadding；失敗則 HEX -> autoPadding=false，並用「剪尾」方式取 JSON/QS 主體 */
function decryptHexLenient(encryptedHex: string, key: string, iv: string): { plaintext: string; mode: string } {
  // 1) 嘗試正常（auto padding）
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    decipher.setAutoPadding(true);
    let out = decipher.update(encryptedHex, "hex", "utf8");
    out += decipher.final("utf8");
    return { plaintext: out, mode: "hex-auto" };
  } catch {}

  // 2) 寬鬆：autoPadding=false 取原始 bytes，再自行剪尾
  const buf = Buffer.from(encryptedHex, "hex");
  const decipher2 = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher2.setAutoPadding(false);
  const raw = Buffer.concat([decipher2.update(buf), decipher2.final()]);
  // 嘗試以 JSON 範圍剪裁：從第一個 { 到最後一個 }
  const txt = raw.toString("utf8");
  const l = txt.indexOf("{");
  const r = txt.lastIndexOf("}");
  if (l !== -1 && r !== -1 && r > l) {
    const core = txt.slice(l, r + 1);
    return { plaintext: core, mode: "hex-lenient-json" };
  }
  // 改用 querystring 偵測（例如 Status=...&Message=...）
  const eqAmpLooksLikeQS = txt.includes("=") && txt.includes("&");
  if (eqAmpLooksLikeQS) {
    // 只取到最後一個完整 key=value 的 '&' 之前
    const lastAmp = txt.lastIndexOf("&");
    const maybeQS = lastAmp > 0 ? txt.slice(0, lastAmp) : txt;
    return { plaintext: maybeQS, mode: "hex-lenient-qs" };
  }

  // 若仍無法鎖定主體，最後仍回傳整段（方便你觀察日志）
  return { plaintext: txt, mode: "hex-lenient-raw" };
}

/** 如果不是純 HEX，再容錯一次 base64（含空白→+、-_/ → +/，補齊 =），同樣用 lenient 剪尾 */
function decryptBase64Lenient(encrypted: string, key: string, iv: string): { plaintext: string; mode: string } {
  const norm = encrypted.replace(/\s+/g, "+").replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "===".slice((norm.length + 3) % 4);

  // 1) 先試 auto padding
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    decipher.setAutoPadding(true);
    let out = decipher.update(padded, "base64", "utf8");
    out += decipher.final("utf8");
    return { plaintext: out, mode: "base64-auto" };
  } catch {}

  // 2) 寬鬆剪尾
  const buf = Buffer.from(padded, "base64");
  const decipher2 = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher2.setAutoPadding(false);
  const raw = Buffer.concat([decipher2.update(buf), decipher2.final()]);
  const txt = raw.toString("utf8");
  const l = txt.indexOf("{");
  const r = txt.lastIndexOf("}");
  if (l !== -1 && r !== -1 && r > l) {
    return { plaintext: txt.slice(l, r + 1), mode: "base64-lenient-json" };
  }
  const lastAmp = txt.lastIndexOf("&");
  if (txt.includes("=") && txt.includes("&")) {
    return { plaintext: lastAmp > 0 ? txt.slice(0, lastAmp) : txt, mode: "base64-lenient-qs" };
  }
  return { plaintext: txt, mode: "base64-lenient-raw" };
}

function smartDecrypt(encrypted: string, key: string, iv: string): { plaintext: string; mode: string } {
  const ti = String(encrypted || "").trim();
  const isHex = /^[0-9a-fA-F]+$/.test(ti) && ti.length % 2 === 0;
  if (isHex) return decryptHexLenient(ti, key, iv);
  return decryptBase64Lenient(ti, key, iv);
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
    // （你剛剛用的）可開關 log：console.log("[customer] 📦 Raw Newebpay body:", raw);

    // 抽 raw 參數（避免 parser 變動內容）
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

    // 先驗章（用 TI_raw 原文）
    const shaOk = TI_raw && sha(TI_raw, HASH_KEY, HASH_IV) === TS_raw;

    // 解密（shaOk 才進）
    let result: any = null;
    let decodeMode = "";
    let decryptError: string | null = null;
    if (shaOk) {
      try {
        const { plaintext, mode } = smartDecrypt(TI_raw, HASH_KEY, HASH_IV);
        decodeMode = mode;
        const payload = parseDecrypted(plaintext);
        result = payload?.Result ?? null;
        if (result?.MerchantOrderNo) orderNo = String(result.MerchantOrderNo) || orderNo;
      } catch (e: any) {
        decryptError = e?.message || String(e);
      }
    }

    // 拿不到 orderNo → 回 /pending（顯示缺少參數）
    if (!orderNo) {
      console.warn(`[customer:${rid}] missing orderNo, shaOk=${shaOk}, tiLen=${(TI_raw || "").length}`);
      return res.writeHead(302, { Location: `/pending` }).end();
    }

    // 映射 Woo 訂單
    const wooOrderId = await findWooOrderIdByNewebpayNo(orderNo);
    if (!wooOrderId) {
      console.warn(`[customer:${rid}] cannot map Woo order for ${orderNo}`);
      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}&refresh=1` }).end();
    }

    // 解不開或 sha 不過 → 在訂單備註留 DEBUG 後導回 pending
    if (!shaOk || !result) {
      try {
        await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
          {
            note: [
              `🧪 [DEBUG] Newebpay Customer (reqId=${rid})`,
              `shaOk=${shaOk}`,
              `tiLen=${(TI_raw || "").length}`,
              decodeMode ? `decodeMode=${decodeMode}` : "",
              decryptError ? `error=${decryptError}` : "",
            ].filter(Boolean).join("\n"),
            customer_note: false,
          },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      } catch {}
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
        // 建備註內容（這裡已經是字串）
const lines =
  [
    `🔔 藍新金流 取號成功（${offsite.PaymentType}）`,
    offsite.BankCode ? `銀行代碼：${offsite.BankCode}` : "",
    (offsite.CodeNo || offsite.PaymentNo) ? `轉帳帳號 / 繳費代碼：${offsite.CodeNo || offsite.PaymentNo}` : "",
    offsite.StoreType ? `超商別：${offsite.StoreType}` : "",
    offsite.ExpireDate ? `繳費期限：${offsite.ExpireDate}` : "",
    offsite.TradeNo ? `交易序號：${offsite.TradeNo}` : "",
    `商店訂單號：${orderNo}`,
    "（CustomerURL 寫入）",
  ]
  .filter(Boolean)
  .join("\n");

// 這裡要改成 note: lines（不要再 .join）
await axios.post(
  `${WC_API_BASE}/orders/${wooOrderId}/notes`,
  { note: lines, customer_note: false },
  { auth: { username: WC_CK, password: WC_CS } }
);

        await axios.put(`${WC_API_BASE}/orders/${wooOrderId}`,
          { meta_data: [{ key: "newebpay_offsite_note_v1", value: "1" }] },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      }
    }

    // 一律帶 orderNo 導回
    return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}` }).end();

  } catch (e: any) {
    console.error(`[customer] error:`, e?.message || e);
    return res.writeHead(302, { Location: `/pending` }).end();
  }
}
