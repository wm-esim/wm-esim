// pages/api/order-info.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

// WooCommerce 認證資料
const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { order_no } = req.query;

  if (typeof order_no !== "string") {
    return res.status(400).json({ error: "Missing or invalid order_no" });
  }

  try {
    // 🔍 改為用 meta_key/meta_value 查詢，而非 search
    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: {
        username: CONSUMER_KEY,
        password: CONSUMER_SECRET,
      },
      params: {
        meta_key: "newebpay_order_no",
        meta_value: order_no,
      },
    });

    const order = orders[0];

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const qrcodeMeta = order.meta_data.find((meta: any) => meta.key === "esim_qrcode");

    return res.status(200).json({
      qrcode: qrcodeMeta?.value || null,
    });
  } catch (error) {
    console.error("❌ 查詢訂單失敗：", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
