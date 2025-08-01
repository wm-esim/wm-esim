// /pages/api/test-esim-order.ts

import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const dummyOrderInfo = {
    name: "測試用戶",
    email: "test@example.com",
    phone: "0900123456",
    esim_plan_id: "20230813A45282eeE1CCee85998876195",
    esim_number: "0900123456",
  };

  const orderNo = `ORDER${Date.now()}`;

  try {
    const wooOrderRes = await axios.post(
      WOOCOMMERCE_API_URL,
      {
        payment_method: "manual",
        payment_method_title: "測試付款",
        set_paid: false,
        billing: {
          first_name: dummyOrderInfo.name,
          email: dummyOrderInfo.email,
          phone: dummyOrderInfo.phone,
        },
        line_items: [
          {
            product_id: 123, // 放你 WooCommerce 上的實際商品 ID
            quantity: 1,
            total: "10",
          },
        ],
        meta_data: [
          { key: "newebpay_order_no", value: orderNo },
          { key: "esim_plan_id", value: dummyOrderInfo.esim_plan_id },
          { key: "esim_number", value: dummyOrderInfo.esim_number },
        ],
      },
      {
        auth: {
          username: CONSUMER_KEY,
          password: CONSUMER_SECRET,
        },
      }
    );

    const wooOrderId = wooOrderRes.data.id;

    const qrcodeRes = await axios.post("https://esim-proxy-production.up.railway.app/esim/qrcode", {
      channel_dataplan_id: dummyOrderInfo.esim_plan_id,
      number: dummyOrderInfo.esim_number,
    });

    const qrcodes = qrcodeRes.data.qrcode || [];

    // 寫入訂單備註
    for (const url of qrcodes) {
      await axios.post(
        `${WOOCOMMERCE_API_URL}/${wooOrderId}/notes`,
        {
          note: `eSIM QRCode：${url}`,
          customer_note: true,
        },
        {
          auth: {
            username: CONSUMER_KEY,
            password: CONSUMER_SECRET,
          },
        }
      );
    }

    res.status(200).json({ message: "測試訂單建立成功", wooOrderId, qrcodes });
  } catch (err: any) {
    console.error("❌ 測試訂單失敗：", err.response?.data || err.message);
    res.status(500).json({ error: "測試失敗", detail: err.response?.data || err.message });
  }
}
