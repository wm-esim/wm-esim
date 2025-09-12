// pages/api/newebpay-notify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";

export const config = { api: { bodyParser: false } };
const NOTIFY_VERSION = "v4.1.0";

/** 建議用環境變數；此處為你現值 */
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

/* ---------- handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const raw = await readBody(req);
    const ct  = String(req.headers["content-type"] || "");
    const body: any = ct.includes("application/json") ? JSON.parse(raw || "{}") : qs.parse(raw);

    const Status    = body?.Status as string | undefined;
    const TradeInfo = body?.TradeInfo as string | undefined;
    const TradeSha  = body?.TradeSha  as string | undefined;

    // ✅ 驗章
    if (TradeInfo && TradeSha) {
      const calc = sha(TradeInfo, HASH_KEY, HASH_IV);
      if (calc !== TradeSha) {
        console.warn("[notify] TradeSha mismatch");
        res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
        return res.status(200).end("OK");
      }
    }

    // ✅ 解密
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

    const payType = String(result?.PaymentType || "").toUpperCase();

    /* A) 取號成功（ATM/超商/WebATM）→ on-hold + meta + 備註（冪等） */
    if (isOffsitePending(result)) {
      const offsite = buildOffsiteInfo(result);

      // 先更新狀態 + meta
      await axios.put(
        `${WC_API_BASE}/orders/${wooOrderId}`,
        {
          status: "on-hold",
          meta_data: [
            { key: "newebpay_offsite_info", value: JSON.stringify(offsite) },
            { key: "newebpay_payment_type", value: payType },
            { key: "newebpay_expire_date",  value: String(offsite?.ExpireDate || "") },
            { key: "newebpay_code_no",      value: String(offsite?.CodeNo || offsite?.PaymentNo || "") },
            { key: "newebpay_bank_code",    value: String(offsite?.BankCode || "") },
          ],
        },
        { auth: { username: WC_CK, password: WC_CS } }
      );

      // 冪等：若已寫過備註就不重覆寫
      const { data: current } = await axios.get(`${WC_API_BASE}/orders/${wooOrderId}`, {
        auth: { username: WC_CK, password: WC_CS },
      });
      const alreadyNoted = (current?.meta_data || []).some(
        (m: any) => m?.key === "newebpay_offsite_note_v1"
      );

      if (!alreadyNoted) {
        const ntd = (x: any) => `NT$ ${Math.round(Number(x || 0)).toLocaleString("zh-TW")}`;
        const lines: string[] = [
          `🔔 藍新金流 取號成功（${payType}）`,
          offsite.BankCode ? `銀行代碼：${offsite.BankCode}` : "",
          (offsite.CodeNo || offsite.PaymentNo)
            ? `轉帳帳號 / 繳費代碼：${offsite.CodeNo || offsite.PaymentNo}` : "",
          offsite.StoreType ? `超商別：${offsite.StoreType}` : "",
          `應繳金額：${ntd(offsite.Amt ?? current?.total)}`,
          offsite.ExpireDate ? `繳費期限：${offsite.ExpireDate}` : "",
          offsite.TradeNo ? `交易序號：${offsite.TradeNo}` : "",
          `商店訂單號：${merchantOrderNo}`,
          "（系統自動加入）",
        ].filter(Boolean);

        await axios.post(
          `${WC_API_BASE}/orders/${wooOrderId}/notes`,
          { note: lines.join("\n"), customer_note: false },
          { auth: { username: WC_CK, password: WC_CS } }
        );
        await axios.put(
          `${WC_API_BASE}/orders/${wooOrderId}`,
          { meta_data: [{ key: "newebpay_offsite_note_v1", value: "1" }] },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      }
    }

    /* B) 已付款（信用卡或 ATM 真入帳）→ processing + 付款 meta（冪等） */
    else if (isPaid(result, Status)) {
      const { data: current } = await axios.get(`${WC_API_BASE}/orders/${wooOrderId}`, {
        auth: { username: WC_CK, password: WC_CS },
      });
      const alreadyPaid = (current?.meta_data || []).some(
        (m: any) => m?.key === "newebpay_pay_time"
      );

      if (!alreadyPaid) {
        await axios.put(
          `${WC_API_BASE}/orders/${wooOrderId}`,
          {
            status: "processing",
            meta_data: [
              { key: "newebpay_trade_no",     value: String(result?.TradeNo || "") },
              { key: "newebpay_pay_time",     value: String(result?.PayTime || "") },
              { key: "newebpay_payment_type", value: payType },
            ],
          },
          { auth: { username: WC_CK, password: WC_CS } }
        );

        // （可選）寫一筆「已入帳」備註
        await axios.post(
          `${WC_API_BASE}/orders/${wooOrderId}/notes`,
          {
            note: `✅ 藍新金流已入帳（${payType}）\n交易序號：${result?.TradeNo || ""}\n入帳時間：${result?.PayTime || ""}`,
            customer_note: false,
          },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      }
    }

    // 其他狀態：略過
    else {
      console.log("[notify] noop:", { Status, PaymentType: result?.PaymentType });
    }

    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK");
  } catch (e: any) {
    console.error("[notify] error:", e?.message || e);
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    // 回 200 避免藍新重試風暴
    return res.status(200).end("OK");
  }
}
