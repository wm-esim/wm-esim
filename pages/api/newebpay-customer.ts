// /pages/api/newebpay-customer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";

/** 讓 Newebpay 能送 raw body（必須） */
export const config = { api: { bodyParser: false } };

/** === 你的設定（建議改 .env） === */
const MERCHANT_ID = "MS3788816305";
const HASH_KEY    = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV     = "PKetlaZYZcZvlMmC";

const WC_API_BASE = "https://fegoesim.com/wp-json/wc/v3";
const WC_CK = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_CS = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

/* ---------- helpers ---------- */
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
function aesDecryptSafe(input: string, key: string, iv: string): string {
  const ti = String(input || "").trim();
  const tryDec = (enc: "hex" | "base64") => {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(key, "utf8"),
      Buffer.from(iv, "utf8")
    );
    decipher.setAutoPadding(true);
    let out = decipher.update(ti, enc, "utf8");
    out += decipher.final("utf8");
    return out;
  };
  if (/^[0-9a-fA-F]+$/.test(ti)) { try { return tryDec("hex"); } catch { return tryDec("base64"); } }
  else                           { try { return tryDec("base64"); } catch { return tryDec("hex"); } }
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
  const hasPay = !!(result?.PayTime || result?.PaymentTime || result?.PayDate || result?.CloseTime);
  return (t === "VACC" || t === "CVS" || t === "WEBATM") && !hasPay;
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

/* ---------- handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    // CustomerURL 只會 POST；若有人誤 GET，就導回首頁
    res.writeHead(302, { Location: "/" }).end();
    return;
  }

  const raw = await readBody(req);
  const getRaw = (name: string): string => {
    const i = raw.indexOf(`${name}=`);
    if (i < 0) return "";
    const s = i + name.length + 1;
    const e = raw.indexOf("&", s);
    return (e === -1 ? raw.slice(s) : raw.slice(s, e)).trim();
  };

  const TI = getRaw("TradeInfo");
  const TS = getRaw("TradeSha");
  let orderNo = "";
  let pendingHandled = false;

  try {
    // 1) verify SHA
    if (!TI || !TS || sha(TI, HASH_KEY, HASH_IV) !== TS) {
      throw new Error("TradeSha mismatch");
    }

    // 2) decrypt
    const decrypted = aesDecryptSafe(TI, HASH_KEY, HASH_IV);
    const payload = parseDecrypted(decrypted);
    const result = payload?.Result || {};
    orderNo = result?.MerchantOrderNo || "";

    // 3) 僅在「取號成功（無入帳時間）」時，寫入 Woo
    if (orderNo && isOffsitePending(result)) {
      const offsite = buildOffsiteInfo(result);
      const wooOrderId = await findWooOrderIdByNewebpayNo(orderNo);
      if (wooOrderId) {
        // on-hold + meta
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

        // 備註（冪等）
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

        pendingHandled = true;
      }
    }
  } catch (e) {
    // 失敗仍導回 pending 頁讓前端輪詢/顯示錯誤
  }

  // 4) 一律導回你的 pending 頁（有 orderNo 就帶上）
  const target = orderNo
    ? `/pending?orderNo=${encodeURIComponent(orderNo)}${pendingHandled ? "" : "&refresh=1"}`
    : `/pending`;

  res.writeHead(302, { Location: target }).end();
}
