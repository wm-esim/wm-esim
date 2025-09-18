// /pages/api/newebpay-customer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import qs from "qs";
import crypto from "crypto";
import axios from "axios";

export const config = { api: { bodyParser: false } };

const MERCHANT_ID = "MS3788816305";
const HASH_KEY    = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV     = "PKetlaZYZcZvlMmC";

const WC_API_BASE = "https://fegoesim.com/wp-json/wc/v3";
const WC_CK = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_CS = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

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
function aesDecryptHexToUtf8(hex: string, key: string, iv: string) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher.setAutoPadding(true);
  let out = decipher.update(hex, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
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
const ntd = (x: any) => `NT$ ${Math.round(Number(x || 0)).toLocaleString("zh-TW")}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const raw = await readBody(req);
  const body = qs.parse(raw); // 這支只有拿 TI/TS，不用 JSON parser
  const TI = String((body as any)?.TradeInfo || "");
  const TS = String((body as any)?.TradeSha  || "");

  // 基本防護：驗證 SHA
  if (!TI || !TS || sha(TI, HASH_KEY, HASH_IV) !== TS) {
    // 即便失敗也導回 pending，避免卡住
    res.writeHead(302, { Location: "/pending" });
    return res.end();
  }

  // 解 TI
  let payload: any = {};
  try {
    payload = qs.parse(aesDecryptHexToUtf8(TI, HASH_KEY, HASH_IV));
    if (typeof payload?.Result === "string") payload.Result = qs.parse(payload.Result);
  } catch {}

  const r = payload?.Result || {};
  const merchantOrderNo = r?.MerchantOrderNo || "";
  const payType = String(r?.PaymentType || "").toUpperCase();

  // 只處理「取號成功但未入帳」的情境 (VACC / CVS / WEBATM)
  const isOffsite = (t: string) => ["VACC","CVS","WEBATM"].includes(t);
  const hasPayMoment = !!(r?.PayTime || r?.PaymentTime || r?.PayDate || r?.CloseTime);

  if (merchantOrderNo && isOffsite(payType) && !hasPayMoment) {
    const offsiteInfo = {
      PaymentType: payType,
      BankCode:    r?.BankCode || r?.BankNo || r?.PayBankCode || "",
      CodeNo:      r?.CodeNo || r?.ATMAccNo || r?.PaymentNo || r?.PayerAccount5Code || "",
      PaymentNo:   r?.PaymentNo || "",
      StoreType:   r?.StoreType || "",
      ExpireDate:  r?.ExpireDate || r?.ExpireTime || "",
      TradeNo:     r?.TradeNo || "",
      Amt:         r?.Amt,
    };

    const wooId = await findWooOrderIdByNewebpayNo(merchantOrderNo);
    if (wooId) {
      // 設為 on-hold + 寫 meta
      await axios.put(`${WC_API_BASE}/orders/${wooId}`, {
        status: "on-hold",
        meta_data: [
          { key: "newebpay_offsite_info", value: JSON.stringify(offsiteInfo) },
          { key: "newebpay_payment_type", value: payType },
          { key: "newebpay_expire_date",  value: String(offsiteInfo?.ExpireDate || "") },
          { key: "newebpay_code_no",      value: String(offsiteInfo?.CodeNo || offsiteInfo?.PaymentNo || "") },
          { key: "newebpay_bank_code",    value: String(offsiteInfo?.BankCode || "") },
        ],
      }, { auth: { username: WC_CK, password: WC_CS } });

      // 補一筆備註（冪等需求可自行再查 meta）
      const lines: string[] = [
        `🔔 藍新金流 取號成功（${payType}）`,
        offsiteInfo.BankCode ? `銀行代碼：${offsiteInfo.BankCode}` : "",
        (offsiteInfo.CodeNo || offsiteInfo.PaymentNo) ? `轉帳帳號 / 繳費代碼：${offsiteInfo.CodeNo || offsiteInfo.PaymentNo}` : "",
        offsiteInfo.StoreType ? `超商別：${offsiteInfo.StoreType}` : "",
        `應繳金額：${ntd(offsiteInfo.Amt)}`,
        offsiteInfo.ExpireDate ? `繳費期限：${offsiteInfo.ExpireDate}` : "",
        offsiteInfo.TradeNo ? `交易序號：${offsiteInfo.TradeNo}` : "",
        `商店訂單號：${merchantOrderNo}`,
        "（系統自動加入）",
      ].filter(Boolean);

      await axios.post(`${WC_API_BASE}/orders/${wooId}/notes`,
        { note: lines.join("\n"), customer_note: false },
        { auth: { username: WC_CK, password: WC_CS } }
      );
    }
  }

  // 無論如何導到 pending（帶上 orderNo，頁面會自己輪詢）
  const location = merchantOrderNo
    ? `/pending?orderNo=${encodeURIComponent(merchantOrderNo)}`
    : "/pending";
  res.writeHead(302, { Location: location });
  res.end();
}
