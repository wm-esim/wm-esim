import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";

export const config = { api: { bodyParser: false } };
const NOTIFY_VERSION = "v4.0.0";

/** 與建單一致 */
const MERCHANT_ID = "MS3788816305";
const HASH_KEY    = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV     = "PKetlaZYZcZvlMmC";

const WC_API_BASE = "https://fegoesim.com/wp-json/wc/v3";
const WC_CK = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_CS = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""; req.on("data", c => data += c);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function sha(encrypted: string, key: string, iv: string) {
  const s = `HashKey=${key}&${encrypted}&HashIV=${iv}`;
  return crypto.createHash("sha256").update(s).digest("hex").toUpperCase();
}
function aesDecrypt(hex: string, key: string, iv: string) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher.setAutoPadding(true);
  let out = decipher.update(hex, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
}
function parseDecrypted(text: string): any {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.Result === "string") {
      try { obj.Result = JSON.parse(obj.Result); } catch { obj.Result = qs.parse(obj.Result); }
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
async function findWooOrderIdByNewebpayNo(merchantOrderNo: string): Promise<number | null> {
  const resp = await axios.get(`${WC_API_BASE}/orders`, {
    auth: { username: WC_CK, password: WC_CS },
    params: { per_page: 50, orderby: "date", order: "desc" },
  });
  const orders = resp.data || [];
  for (const o of orders) {
    const hit = (o.meta_data || []).some((m: any) => m?.key === "newebpay_order_no" && m?.value === merchantOrderNo);
    if (hit) return Number(o.id);
  }
  return null;
}
function isPaid(result: any, status?: string) {
  const t = String(result?.PaymentType || "").toUpperCase();
  return !!result?.PayTime || (t === "CREDIT" && status === "SUCCESS");
}
function isOffsitePending(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  return (t === "VACC" || t === "CVS" || t === "WEBATM") && !result?.PayTime;
}
function buildOffsiteInfo(result: any) {
  return {
    PaymentType: result?.PaymentType,
    BankCode: result?.BankCode || result?.BankNo,
    CodeNo: result?.CodeNo || result?.ATMAccNo || result?.PaymentNo,
    PaymentNo: result?.PaymentNo,
    StoreType: result?.StoreType,
    ExpireDate: result?.ExpireDate || result?.ExpireTime,
    TradeNo: result?.TradeNo,
    Amt: result?.Amt,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("X-Notify-Rev", NOTIFY_VERSION); return res.status(405).end("Method Not Allowed"); }

  try {
    const raw = await readBody(req);
    const ct  = String(req.headers["content-type"] || "");
    const body: any = ct.includes("application/json") ? JSON.parse(raw || "{}") : qs.parse(raw);

    const Status    = body?.Status as string | undefined;
    const TradeInfo = body?.TradeInfo as string | undefined;
    const TradeSha  = body?.TradeSha  as string | undefined;

    // ✅ 驗章（有 TradeInfo 才驗）
    if (TradeInfo && TradeSha) {
      const calc = sha(TradeInfo, HASH_KEY, HASH_IV);
      if (calc !== TradeSha) {
        console.warn("[notify] TradeSha mismatch");
        res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
        return res.status(200).end("OK");
      }
    }

    let result: any = null;
    if (TradeInfo && /^[0-9a-fA-F]+$/.test(TradeInfo)) {
      const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
      const payload   = parseDecrypted(decrypted);
      result = payload?.Result || null;
    } else {
      console.warn("[notify] invalid TradeInfo");
    }

    const merchantOrderNo = result?.MerchantOrderNo || body?.MerchantOrderNo;
    if (!merchantOrderNo) {
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    const wooOrderId = await findWooOrderIdByNewebpayNo(merchantOrderNo);
    if (!wooOrderId) {
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    // (A) 已付款
    if (isPaid(result, Status)) {
      await axios.put(
        `${WC_API_BASE}/orders/${wooOrderId}`,
        {
          status: "processing",
          meta_data: [
            { key: "newebpay_trade_no",   value: String(result?.TradeNo || "") },
            { key: "newebpay_pay_time",   value: String(result?.PayTime || "") },
            { key: "newebpay_payment_type", value: String(result?.PaymentType || "") },
          ],
        },
        { auth: { username: WC_CK, password: WC_CS } }
      );
      // 若要在這裡「同時」開 eSIM + 發票，可把 callback 的對應段落搬過來，
      // 加上冪等檢查（避免重複開立）。
    }
    // (B) 待繳（ATM/超商/WebATM 取號）
    else if (isOffsitePending(result)) {
      const offsiteInfo = buildOffsiteInfo(result);
      await axios.put(
        `${WC_API_BASE}/orders/${wooOrderId}`,
        {
          status: "on-hold",
          meta_data: [
            { key: "newebpay_offsite_info", value: JSON.stringify(offsiteInfo) },
            { key: "newebpay_payment_type", value: String(result?.PaymentType || "") },
            { key: "newebpay_expire_date",  value: String(offsiteInfo?.ExpireDate || "") },
            { key: "newebpay_code_no",      value: String(offsiteInfo?.CodeNo || offsiteInfo?.PaymentNo || "") },
            { key: "newebpay_bank_code",    value: String(offsiteInfo?.BankCode || "") },
          ],
        },
        { auth: { username: WC_CK, password: WC_CS } }
      );
    } else {
      // 其他狀態：記錄即可
      console.log("[notify] noop:", { Status, PaymentType: result?.PaymentType });
    }

    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK");
  } catch (e: any) {
    console.error("[notify] error:", e?.message || e);
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK"); // 仍回 200，避免重試風暴
  }
}
