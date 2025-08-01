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

  // ✅ 將 &、/、\ 等特殊符號統一轉為 -
  orderNo = orderNo.replace(/[&\/\\]/g, "-");

  try {
    // 🔍 拉最近 20 筆用 meta_data 找符合的訂單
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

    const meta = order.meta_data || [];
    const getMeta = (key: string) => meta.find((m: any) => m.key === key)?.value;

    const qrcode = getMeta("esim_qrcode");
    const esim_plan_id = getMeta("esim_plan_id");
    const esim_topup_id = getMeta("esim_topup_id");

    const orderInfo = {
      status: order.status,
      MerchantOrderNo: orderNo,
      PaymentType: order.payment_method_title || "",
      PayTime: order.date_paid,
      TradeNo: order.transaction_id || "",
    };

    return res.status(200).json({ qrcode, esim_plan_id, esim_topup_id, orderInfo });
  } catch (err: any) {
    console.error("❌ 查詢 WooCommerce 訂單失敗", err.message);
    return res.status(500).json({ error: "WooCommerce 查詢失敗", details: err.message });
  }
}
