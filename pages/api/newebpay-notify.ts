// pages/api/newebpay-notify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";

/** ✅ 關閉內建 JSON 解析，自己讀 raw（NewebPay 通常用 x-www-form-urlencoded） */
export const config = { api: { bodyParser: false } };

/** ✅ 版本號（方便觀察是否為最新部署） */
const NOTIFY_VERSION = "v4.0.0";

/** === 你的金鑰/設定（與建單一致） === */
const MERCHANT_ID = "MS3788816305";
const HASH_KEY    = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV     = "PKetlaZYZcZvlMmC";

const WC_API_BASE      = "https://fegoesim.com/wp-json/wc/v3";
const WC_CK            = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_CS            = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

/** ---- 小工具 ---- */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
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

/** 解析解密後文字：
 *  你的建單使用 RespondType=JSON，所以正常會是 JSON。
 *  但為了保險，這裡也容忍 querystring 格式。
 */
function parseDecrypted(text: string): any {
  try {
    const obj = JSON.parse(text); // { Status, Message, Result: {...} } 或直接是 Result
    // 有些實作會直接把 Result 字串化，這裡也一併處理
    if (obj && obj.Result && typeof obj.Result === "string") {
      try {
        obj.Result = JSON.parse(obj.Result);
      } catch {
        // 有些老版本會是 querystring
        const r = Object.fromEntries(new URLSearchParams(obj.Result) as any);
        obj.Result = r;
      }
    }
    return obj;
  } catch {
    // 非 JSON → 當作 querystring
    const r = Object.fromEntries(new URLSearchParams(text) as any);
    return { Result: r };
  }
}

/** 取 Woo 訂單：用先前寫入的 meta_key=newebpay_order_no 去比對 */
async function findWooOrderIdByNewebpayNo(merchantOrderNo: string): Promise<number | null> {
  try {
    // Woo 沒有直接用 meta 查詢 API，最穩定的方式是抓最近 N 筆掃描
    const resp = await axios.get(`${WC_API_BASE}/orders`, {
      auth: { username: WC_CK, password: WC_CS },
      params: { per_page: 50, orderby: "date", order: "desc" },
    });
    const orders = resp.data || [];
    for (const o of orders) {
      const metas: any[] = o.meta_data || [];
      const hit = metas.find(
        (m) => m?.key === "newebpay_order_no" && m?.value === merchantOrderNo
      );
      if (hit) return o.id as number;
    }
  } catch (e) {
    console.error("[notify] Woo order search error:", (e as any)?.message || e);
  }
  return null;
}

/** 決定是否「已付款完成」：卡/已授權會有 PayTime；ATM/超商待繳則沒有 */
function isPaid(result: any, status: string | undefined) {
  const payType = String(result?.PaymentType || "").toUpperCase();
  const hasPayTime = !!result?.PayTime;
  // 信用卡通常 Status=SUCCESS 且有 PayTime
  if (payType === "CREDIT" && status === "SUCCESS") return true;
  // 其它方式只要出現 PayTime 也算完成
  if (hasPayTime) return true;
  return false;
}

/** 是否為「待繳費（要顯示匯款/代碼資訊）」 */
function isOffsitePending(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  // 這些類型會在初次產生時回傳繳費資訊（銀行代碼/虛擬帳號/逾期時間等）
  return t === "VACC" || t === "CVS" || t === "WEBATM";
}

/** 從 Result 萃取要保存的繳費資訊（欄位名稱可能依版本異動，做多種容錯） */
function buildOffsiteInfo(result: any) {
  return {
    PaymentType: result?.PaymentType,      // VACC / CVS / WEBATM ...
    BankCode: result?.BankCode || result?.BankNo,
    CodeNo: result?.CodeNo || result?.ATMAccNo || result?.PaymentNo,
    PaymentNo: result?.PaymentNo,          // CVS 代碼
    StoreType: result?.StoreType,          // CVS 別
    ExpireDate: result?.ExpireDate || result?.ExpireTime,
    TradeNo: result?.TradeNo,
    Amt: result?.Amt,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 僅允許 POST
  if (req.method !== "POST") {
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const raw = await readBody(req);
    const ct = String(req.headers["content-type"] || "");

    // 解析 body (x-www-form-urlencoded / JSON)
    const body: any = ct.includes("application/json") ? JSON.parse(raw || "{}") : qs.parse(raw);
    const Status    = body?.Status as string | undefined;
    const TradeInfo = body?.TradeInfo as string | undefined;

    let payload: any = null; // 預期 { Status, Result: {...} }
    let result: any  = null;

    // 嘗試解密 TradeInfo
    if (TradeInfo && /^[0-9a-fA-F]+$/.test(TradeInfo)) {
      try {
        const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
        payload = parseDecrypted(decrypted);           // { Status?, Result: {...} }
        result  = payload?.Result || null;
      } catch (e: any) {
        console.warn("[notify] decrypt/parse failed:", e?.message || e);
      }
    } else {
      console.warn("[notify] no/invalid TradeInfo:", TradeInfo);
    }

    const merchantOrderNo =
      result?.MerchantOrderNo || body?.MerchantOrderNo || payload?.MerchantOrderNo;

    console.log("[notify] hit", {
      ver: NOTIFY_VERSION,
      Status,
      PaymentType: result?.PaymentType,
      MerchantOrderNo: merchantOrderNo,
      hasResult: !!result,
    });

    if (!merchantOrderNo) {
      // 找不到對應的訂單號也回 200（避免藍新重試），但記錄
      console.warn("[notify] missing MerchantOrderNo");
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    // 1) 找 Woo 訂單
    const wooOrderId = await findWooOrderIdByNewebpayNo(merchantOrderNo);
    if (!wooOrderId) {
      console.warn("[notify] Woo order not found for:", merchantOrderNo);
      res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
      return res.status(200).end("OK");
    }

    // 2) 分支處理
    // (A) 已付款完成 → 轉 processing，寫入交易資訊
    if (isPaid(result, Status)) {
      try {
        const meta = [
          { key: "newebpay_trade_no", value: String(result?.TradeNo || "") },
          { key: "newebpay_pay_time", value: String(result?.PayTime || "") },
          { key: "newebpay_payment_type", value: String(result?.PaymentType || "") },
        ];

        await axios.put(
          `${WC_API_BASE}/orders/${wooOrderId}`,
          {
            status: "processing",
            meta_data: meta,
          },
          { auth: { username: WC_CK, password: WC_CS } }
        );

        console.log("[notify] order updated to processing:", wooOrderId);
      } catch (e) {
        console.error("[notify] update paid order failed:", (e as any)?.message || e);
      }
    }
    // (B) 待繳費（ATM/超商 產生代碼/虛擬帳號）→ 寫入繳費資訊，狀態維持/改為 on-hold
    else if (isOffsitePending(result)) {
      try {
        const offsiteInfo = buildOffsiteInfo(result);
        const meta = [
          { key: "newebpay_offsite_info", value: JSON.stringify(offsiteInfo) },
          { key: "newebpay_payment_type", value: String(result?.PaymentType || "") },
          { key: "newebpay_expire_date", value: String(offsiteInfo?.ExpireDate || "") },
          { key: "newebpay_code_no", value: String(offsiteInfo?.CodeNo || offsiteInfo?.PaymentNo || "") },
          { key: "newebpay_bank_code", value: String(offsiteInfo?.BankCode || "") },
        ];

        await axios.put(
          `${WC_API_BASE}/orders/${wooOrderId}`,
          {
            status: "on-hold", // 待付款
            meta_data: meta,
          },
          { auth: { username: WC_CK, password: WC_CS } }
        );

        console.log("[notify] offsite info saved for order:", wooOrderId, offsiteInfo);
      } catch (e) {
        console.error("[notify] save offsite info failed:", (e as any)?.message || e);
      }
    } else {
      // 其它狀態：記錄即可（例如失敗、取消等，可按需擴充）
      console.log("[notify] no-op branch. Status:", Status, "PaymentType:", result?.PaymentType);
    }

    // 3) 回應 200（很重要，避免藍新重試太多次）
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK");
  } catch (e: any) {
    console.error("[notify] handler error:", e?.message || e);
    // 即便出錯，也回 200，避免藍新重試雪崩
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK");
  }
}
