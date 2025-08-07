import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const WC_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  let { orderNo } = req.query;

  if (!orderNo || typeof orderNo !== "string") {
    return res.status(400).json({ error: "缺少訂單編號（orderNo）" });
  }

  orderNo = orderNo.replace(/[&\/\\]/g, "-");

  try {
    const { data: orders } = await axios.get(WC_API_URL, {
      auth: {
        username: CONSUMER_KEY,
        password: CONSUMER_SECRET,
      },
      params: {
        per_page: 20,
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

    const qrcodes: { name: string; src: string }[] = [];

    for (const item of order.line_items) {
      const productId = item.product_id;
      const productRes = await axios.get(
        `https://fegoesim.com/wp-json/wc/v3/products/${productId}`,
        {
          auth: {
            username: CONSUMER_KEY,
            password: CONSUMER_SECRET,
          },
        }
      );

      const product = productRes.data;
      const name = product.name;

      // 嘗試從訂單的 line_items.meta_data 內取得該商品對應 QRCode
      const itemMeta = item.meta_data || [];
      const qrcode = itemMeta.find((m: any) => m.key === "esim_qrcode")?.value;

      if (qrcode) {
        qrcodes.push({ name, src: qrcode });
      }
    }

    const orderInfo = {
      status: order.status,
      MerchantOrderNo: orderNo,
      PaymentType: order.payment_method_title || "",
      PayTime: order.date_paid,
      TradeNo: order.transaction_id || "",
    };

    return res.status(200).json({ qrcodes, orderInfo });
  } catch (err: any) {
    console.error("❌ 查詢 WooCommerce 訂單失敗", err.message);
    return res.status(500).json({ error: "WooCommerce 查詢失敗", details: err.message });
  }
}
