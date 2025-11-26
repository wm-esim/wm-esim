// pages/api/get-qrcode/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import https from "https";

const WC_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

// ★★★ 忽略 SSL 檢查 ★★★
const agent = new https.Agent({ rejectUnauthorized: false });

const axiosConfig = {
  httpsAgent: agent,
  timeout: 5000, // ★★★ 設定 5 秒超時，防止無限卡死 ★★★
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/json"
  },
  auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let orderNo = req.query.orderNo || req.body.orderNo;
  if (!orderNo) return res.status(400).json({ error: "Missing orderNo" });
  orderNo = String(orderNo).replace(/[&/\\]/g, "-");

  try {
    console.log(`🚀 [get-qrcode] Start fetching for: ${orderNo}`);

    // 1. 嘗試連線
    const { data: orders } = await axios.get(WC_API_URL, {
      ...axiosConfig,
      params: { per_page: 50, order: "desc", orderby: "date" },
    });

    console.log(`✅ [get-qrcode] Connection success! Got ${orders.length} orders.`);

    // 2. 搜尋訂單
    const targetOrder = orders.find((o: any) => 
      o.meta_data?.some((m: any) => m.key === "newebpay_order_no" && m.value === orderNo)
    );

    if (!targetOrder) {
      console.warn(`⚠️ Order not found in recent list: ${orderNo}`);
      return res.status(404).json({ error: "Order not found" });
    }

    // 3. 提取 QRCode
    const meta = targetOrder.meta_data || [];
    const qrcodeMeta = meta.find((m: any) => m.key === "esim_qrcodes");
    let qrcodes = [];
    if (qrcodeMeta && qrcodeMeta.value) {
      try {
        qrcodes = typeof qrcodeMeta.value === "string" ? JSON.parse(qrcodeMeta.value) : qrcodeMeta.value;
      } catch (e) {}
    }

    return res.status(200).json({
      success: true,
      qrcodes,
      orderInfo: {
        status: targetOrder.status,
        MerchantOrderNo: orderNo,
      }
    });

  } catch (error: any) {
    // ★★★ 這裡是重點：印出詳細錯誤 ★★★
    const msg = error.code === 'ECONNABORTED' ? '連線超時 (Timeout)' : error.message;
    console.error(`❌ [API Error] ${msg}`, error?.response?.status);
    
    return res.status(500).json({ 
      error: "Server Error", 
      details: msg,
      fullError: error.message
    });
  }
}