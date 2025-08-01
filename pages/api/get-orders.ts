import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const WC_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = process.env.NEXT_PUBLIC_WC_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.NEXT_PUBLIC_WC_CONSUMER_SECRET!;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = req.query;

  if (!userId) return res.status(400).json({ error: "缺少 userId" });

  try {
    const { data: orders } = await axios.get(WC_API_URL, {
      auth: {
        username: CONSUMER_KEY,
        password: CONSUMER_SECRET,
      },
      params: {
        customer: userId,
        per_page: 100, // 確保抓最多資料
        status: "any", // 所有狀態都抓
      },
    });

    // ✅ 印出訂單 ID 與狀態以便除錯
    console.log("✅ WooCommerce 訂單清單：");
    orders.forEach((order: any) => {
      console.log(`- 訂單 #${order.id} | 狀態：${order.status} | customer_id: ${order.customer_id}`);
    });

    res.status(200).json(orders);
  } catch (error: any) {
    console.error("❌ WooCommerce 訂單查詢錯誤:", error.message);
    res.status(500).json({ error: "訂單查詢失敗", detail: error.message });
  }
}
