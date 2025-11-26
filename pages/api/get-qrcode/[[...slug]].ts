// pages/api/get-qrcode/[[...slug]].ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import https from "https";

// ★★★ Cloudflare IP 直連設定 ★★★
// 使用你 Ping 到的 IP，繞過 DNS 解析的阻擋
const WP_IP = "172.67.197.245"; 
const WC_API_URL = `https://${WP_IP}/wp-json/wc/v3/orders`;

// 請確認這裡的金鑰是否正確
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

// 忽略 SSL 憑證錯誤 (因為我們用 IP 連線，憑證會對不上，這是正常的)
const agent = new https.Agent({ rejectUnauthorized: false });

const axiosConfig = {
  httpsAgent: agent,
  timeout: 10000, // 給它 10 秒
  headers: {
    // ★★★ 關鍵 Header：告訴 Cloudflare 我們是要連 fegoesim.com ★★★
    "Host": "fegoesim.com", 
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/json"
  },
  auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 處理 CORS 與 Method
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // 取得 orderNo (無論是 GET 還是 POST)
  let orderNo = req.query.orderNo || req.body.orderNo;
  
  // 處理 Next.js 萬用路由可能把 orderNo 擠到 query 陣列的情況
  if (!orderNo && req.query) {
     // 有時候 query 會變成 { slug: [...], orderNo: ... }
     // 這裡做一個防呆檢查
  }

  if (!orderNo) {
    // 如果是萬用路由的第一次載入 (無參數)，可以直接回傳一個空訊息
    return res.status(400).json({ error: "Missing orderNo" });
  }

  // 清理參數
  orderNo = String(orderNo).replace(/[&/\\]/g, "-");

  try {
    console.log(`🚀 [get-qrcode] Direct connecting to Cloudflare IP (${WP_IP}) for: ${orderNo}`);

    // 1. 搜尋訂單
    const { data: orders } = await axios.get(WC_API_URL, {
      ...axiosConfig,
      params: { per_page: 50, order: "desc", orderby: "date" },
    });

    console.log(`✅ [get-qrcode] Connected! Got ${orders.length} orders.`);

    const targetOrder = orders.find((o: any) => 
      o.meta_data?.some((m: any) => m.key === "newebpay_order_no" && m.value === orderNo)
    );

    if (!targetOrder) {
      console.warn(`❌ Order not found: ${orderNo}`);
      return res.status(404).json({ error: "Order not found" });
    }

    // 2. 解析 QRCode
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
        PaymentType: meta.find((m: any) => m.key === "newebpay_payment_type")?.value || "",
      }
    });

  } catch (error: any) {
    const msg = error.code === 'ECONNABORTED' ? 'Cloudflare Blocked Request (Timeout)' : error.message;
    console.error(`❌ API Error: ${msg}`);
    return res.status(500).json({ error: msg, details: error.message });
  }
}