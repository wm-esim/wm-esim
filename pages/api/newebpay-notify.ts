// /pages/api/newebpay-notify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";

export const config = { api: { bodyParser: false } };
const NOTIFY_VERSION = "v4.2.0";

/** 建議改 .env；此處沿用你現值 */
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
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function sha(encryptedHex: string, key: string, iv: string) {
  const s = `HashKey=${key}&${encryptedHex}&HashIV=${iv}`;
  return crypto.createHash("sha256").update(s).digest("hex").toUpperCase();
}
function aesDecrypt(hex: string, key: string, iv: string) {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8")
  );
  decipher.setAutoPadding(true);
  let out = decipher.update(hex, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
}
function parseDecrypted(text: string): any {
  // 兼容 JSON 或 x-www-form-urlencoded；且 Result 可能是字串
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.Result === "string") {
      try {
        obj.Result = JSON.parse(obj.Result);
      } catch {
        obj.Result = qs.parse(obj.Result);
      }
    }
    return obj;
  } catch {
    const r = qs.parse(text);
    if ((r as any).Result && typeof (r as any).Result === "string") {
      try {
        (r as any).Result = JSON.parse((r as any).Result as string);
      } catch {
        (r as any).Result = qs.parse((r as any).Result as string);
      }
    }
    return r;
  }
}

async function findWooOrderIdByNewebpayNo(
  merchantOrderNo: string
): Promise<number | null> {
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

/** 僅判斷是否屬於「取號成功」（尚未入帳） */
function isPaymentInfoPending(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  // 取號事件不會有 PayTime；付款入帳才會有 PayTime（交給 callback）
  return (
    (t === "VACC" || t === "CVS" || t === "WEBATM" || t === "BARCODE") &&
    !result?.PayTime
  );
}

/** 取號欄位總表（含 ATM 的 vAccount、BARCODE 三段） */
function buildOffsiteInfo(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  const base = {
    PaymentType: t,
    TradeNo: result?.TradeNo,
    Amt: result?.Amt,
    ExpireDate: result?.ExpireDate || result?.ExpireTime,
  };
  if (t === "VACC")
    return { ...base, BankCode: result?.BankCode, vAccount: result?.vAccount };
  if (t === "CVS")
    return {
      ...base,
      StoreType: result?.StoreType,
      PaymentNo: result?.PaymentNo,
      CodeNo: result?.CodeNo,
    };
  if (t === "WEBATM")
    return { ...base, BankCode: result?.BankCode, ATMAccNo: result?.ATMAccNo };
  if (t === "BARCODE")
    return {
      ...base,
      Barcode1: result?.Barcode1,
      Barcode2: result?.Barcode2,
      Barcode3: result?.Barcode3,
    };
  return base;
}

const ntd = (x: any) =>
  `NT$ ${Math.round(Number(x || 0)).toLocaleString("zh-TW")}`;

/* ---------- handler ---------- */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const raw = await readBody(req);
    const ct = String(req.headers["content-type"] || "");
    const body: any = ct.includes("application/json")
      ? JSON.parse(raw || "{}")
      : qs.parse(raw);

    const TradeInfo = body?.TradeInfo as string | undefined;
    const TradeSha = body?.TradeSha as string | undefined;

    // 缺參數直接回 200（避免重試風暴）
    if (!TradeInfo || !TradeSha) {
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    // ✅ 驗章
    const calc = sha(TradeInfo, HASH_KEY, HASH_IV);
    if (calc !== TradeSha) {
      console.warn("[notify] TradeSha mismatch");
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    // ✅ 解密
    if (!/^[0-9a-fA-F]+$/.test(TradeInfo)) {
      console.warn("[notify] invalid TradeInfo (not hex)");
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }
    const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
    const payload = parseDecrypted(decrypted);
    const result = payload?.Result || {};
    const merchantOrderNo = result?.MerchantOrderNo || body?.MerchantOrderNo;

    if (!merchantOrderNo) {
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    // 只處理「取號成功」；入帳移交 callback
    if (!isPaymentInfoPending(result)) {
      // 這裡可能是信用卡入帳或 ATM 真入帳的 Notify（交給 /api/newebpay-callback）
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    const wooOrderId = await findWooOrderIdByNewebpayNo(merchantOrderNo);
    if (!wooOrderId) {
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    const offsite = buildOffsiteInfo(result);
    const payType = String(offsite?.PaymentType || "");

    // 讀一次取得金額與冪等判斷
    const { data: current } = await axios.get(
      `${WC_API_BASE}/orders/${wooOrderId}`,
      { auth: { username: WC_CK, password: WC_CS } }
    );
    const alreadyNoted = (current?.meta_data || []).some(
      (m: any) => m?.key === "newebpay_offsite_note_v2"
    );

    // ✅ 寫入狀態 + 取號資訊（冪等）
    await axios.put(
      `${WC_API_BASE}/orders/${wooOrderId}`,
      {
        status: "on-hold",
        meta_data: [
          { key: "newebpay_offsite_info", value: JSON.stringify(offsite) },
          { key: "newebpay_payment_type", value: payType },
          { key: "newebpay_expire_date", value: String(offsite?.ExpireDate || "") },
          {
            key: "newebpay_code_no",
            value: String(
              (offsite as any)?.CodeNo ||
                (offsite as any)?.PaymentNo ||
                (offsite as any)?.vAccount ||
                ""
            ),
          },
          { key: "newebpay_bank_code", value: String((offsite as any)?.BankCode || "") },
          { key: "newebpay_vaccount", value: String((offsite as any)?.vAccount || "") },
        ],
      },
      { auth: { username: WC_CK, password: WC_CS } }
    );

    if (!alreadyNoted) {
      const lines: string[] = [
        `🔔 藍新金流 取號成功（${payType}）`,
        (offsite as any).BankCode ? `銀行代碼：${(offsite as any).BankCode}` : "",
        (offsite as any).vAccount
          ? `虛擬帳號：${(offsite as any).vAccount}`
          : (offsite as any).CodeNo || (offsite as any).PaymentNo
          ? `繳費代碼：${(offsite as any).CodeNo || (offsite as any).PaymentNo}`
          : "",
        (offsite as any).StoreType ? `超商別：${(offsite as any).StoreType}` : "",
        `應繳金額：${ntd((offsite as any).Amt ?? current?.total)}`,
        (offsite as any).ExpireDate ? `繳費期限：${(offsite as any).ExpireDate}` : "",
        (offsite as any).TradeNo ? `交易序號：${(offsite as any).TradeNo}` : "",
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
        { meta_data: [{ key: "newebpay_offsite_note_v2", value: "1" }] },
        { auth: { username: WC_CK, password: WC_CS } }
      );
    }

    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK");
  } catch (e: any) {
    console.error("[notify] error:", e?.message || e);
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    // 一律回 200 避免藍新重試風暴
    return res.status(200).end("OK");
  }
}
