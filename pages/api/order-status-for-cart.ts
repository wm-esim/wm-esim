import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

// WooCommerce API
const WOOCOMMERCE_API_URL =
  "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { orderNo } = req.query;

  if (!orderNo || typeof orderNo !== "string") {
    return res.status(400).json({ error: "缺少 orderNo 參數" });
  }

  try {
    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: {
        username: CONSUMER_KEY,
        password: CONSUMER_SECRET,
      },
      params: {
        per_page: 20,
        orderby: "date",
        order: "desc",
      },
    });

    const order = orders.find((o: any) =>
      o.meta_data?.some(
        (meta: any) => meta.key === "newebpay_order_no" && meta.value === orderNo
      )
    );

    if (!order) {
      return res.status(404).json({ error: "找不到訂單" });
    }

    // 從 meta_data 抓取 QRCode
    const qrcodeMeta = order.meta_data.find(
      (meta: any) => meta.key === "esim_qrcode"
    );

    res.status(200).json({
      orderNo,
      status: order.status,
      payment_method_title: order.payment_method_title,
      date_paid: order.date_paid,
      qrcode: qrcodeMeta?.value || null,
    });
  } catch (error: any) {
    console.error("查詢失敗:", error.message);
    res.status(500).json({ error: "伺服器錯誤" });
  }
}
