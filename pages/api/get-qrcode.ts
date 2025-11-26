// pages/api/get-qrcode.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import https from "https";

const WC_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
// 這裡請確認你的金鑰是否正確
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

const agent = new https.Agent({ rejectUnauthorized: false });
const axiosConfig = {
  httpsAgent: agent,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/json"
  },
  auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 允許 GET 或 POST，增加彈性
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  let orderNo = req.query.orderNo || req.body.orderNo;
  
  if (!orderNo) {
    return res.status(400).json({ error: "Missing orderNo" });
  }
  
  // 轉成字串並清理
  orderNo = String(orderNo).replace(/[&/\\]/g, "-");

  try {
    console.log(`🔍 [get-qrcode] Searching: ${orderNo}`);

    // 1. 搜尋訂單
    const { data: orders } = await axios.get(WC_API_URL, {
      ...axiosConfig,
      params: { per_page: 50, order: "desc", orderby: "date" },
    });

    const targetOrder = orders.find((o: any) => 
      o.meta_data?.some((m: any) => m.key === "newebpay_order_no" && m.value === orderNo)
    );

    if (!targetOrder) {
      console.warn(`❌ Not found in list: ${orderNo}`);
      return res.status(404).json({ error: "Order not found", searched: orderNo });
    }

    // 2. 抓取 meta data
    const meta = targetOrder.meta_data || [];
    const qrcodeMeta = meta.find((m: any) => m.key === "esim_qrcodes");
    
    let qrcodes = [];
    if (qrcodeMeta && qrcodeMeta.value) {
      try {
        qrcodes = typeof qrcodeMeta.value === "string" 
          ? JSON.parse(qrcodeMeta.value) 
          : qrcodeMeta.value;
      } catch (e) {
        console.error("JSON Parse Error", e);
      }
    }

    // 回傳成功資料
    return res.status(200).json({
      success: true,
      qrcodes,
      orderInfo: {
        status: targetOrder.status,
        MerchantOrderNo: orderNo,
        PaymentType: meta.find((m: any) => m.key === "newebpay_payment_type")?.value || "",
        PayTime: meta.find((m: any) => m.key === "newebpay_pay_time")?.value || "",
        TradeNo: meta.find((m: any) => m.key === "newebpay_trade_no")?.value || "",
      }
    });

  } catch (error: any) {
    console.error("API Error", error.message);
    return res.status(500).json({ error: error.message });
  }
}