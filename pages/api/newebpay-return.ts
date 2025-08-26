// pages/api/newebpay-return.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";

const MERCHANT_ID = "MS3788816305";
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3";
const CONSUMER_KEY = "ck_ef9f4...bc2";
const CONSUMER_SECRET = "cs_3da59...0d4";

function aesDecrypt(hex: string, key: string, iv: string) {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8"),
  );
  decipher.setAutoPadding(true);
  const text = Buffer.from(hex, "hex").toString("binary");
  let decoded = decipher.update(text, "binary", "utf8");
  decoded += decipher.final("utf8");
  return decoded;
}

function parseQueryString(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  new URLSearchParams(qs).forEach((v, k) => (out[k] = v));
  return out;
}

async function findWooOrderIdByNewebpayNo(merchantOrderNo: string) {
  // Woo REST 沒有直接用 meta 查詢的參數，保險做法：抓最近一批訂單掃描
  const resp = await axios.get(`${WOOCOMMERCE_API_URL}/orders`, {
    auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    params: { per_page: 50, orderby: "date", order: "desc" },
  });
  const orders = resp.data || [];
  for (const o of orders) {
    const metas: any[] = o.meta_data || [];
    const hit = metas.find(
      (m) => m?.key === "newebpay_order_no" && m?.value === merchantOrderNo,
    );
    if (hit) return o.id;
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 藍新 MPG 回傳可能是 POST (表單) 或 GET，這裡兩者都處理
    const { TradeInfo } = (req.method === "POST" ? req.body : req.query) as { TradeInfo?: string };
    if (!TradeInfo) {
      return res.status(400).send("Missing TradeInfo");
    }

    // 1) 解密 & 解析
    const jsonStr = aesDecrypt(String(TradeInfo), HASH_KEY, HASH_IV);
    const trade = JSON.parse(jsonStr);           // { Status, Result: {...} }
    const r = trade?.Result || {};

    const merchantOrderNo = r?.MerchantOrderNo as string | undefined;
    const paymentType = r?.PaymentType as string | undefined; // e.g. "VACC", "CVS", "CREDIT"
    // ATM/匯款資訊（不同類型有不同欄位）
    const paymentInfo: Record<string, any> = {
      PaymentType: paymentType,
      BankCode: r?.BankCode,        // ATM 銀行代碼
      CodeNo: r?.CodeNo || r?.ATMAccNo, // 虛擬帳號/繳費代碼 (欄位名稱因版本不同)
      ExpireDate: r?.ExpireDate,    // 繳費期限
      StoreType: r?.StoreType,      // CVS 類型
      PaymentNo: r?.PaymentNo,      // CVS 代碼
      TradeNo: r?.TradeNo,
      Amt: r?.Amt,
    };

    if (!merchantOrderNo) {
      return res.status(400).send("Missing MerchantOrderNo");
    }

    // 2) 找回對應 Woo 訂單
    const wooOrderId = await findWooOrderIdByNewebpayNo(merchantOrderNo);
    if (!wooOrderId) {
      console.warn("⚠️ 找不到對應的 Woo 訂單：", merchantOrderNo);
      return res.status(200).send("OK");
    }

    // 3) 如果是「待付款」類型（ATM/超商），把繳費資訊寫入 meta，讓會員或訂單頁可查看
    const pendingTypes = new Set(["VACC", "CVS", "WEBATM"]); // 視情況調整
    if (paymentType && pendingTypes.has(paymentType)) {
      const meta = [
        { key: "newebpay_offsite_info", value: JSON.stringify(paymentInfo) },
        // 也可以拆成多欄，方便後台看
        { key: "newebpay_bank_code", value: paymentInfo.BankCode || "" },
        { key: "newebpay_code_no", value: paymentInfo.CodeNo || paymentInfo.PaymentNo || "" },
        { key: "newebpay_expire_date", value: paymentInfo.ExpireDate || "" },
      ];

      await axios.put(
        `${WOOCOMMERCE_API_URL}/orders/${wooOrderId}`,
        {
          // 訂單狀態通常維持 "on-hold"（待付款），直到藍新「付款完成」NotifyURL 再改為 processing/completed
          status: "on-hold",
          meta_data: meta,
        },
        { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } },
      );
    }

    // 4) 回應 200 給藍新
    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ /api/newebpay-return error", err);
    return res.status(500).send("Error");
  }
}
