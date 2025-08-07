// ✅ 改寫後的 /api/linepay/confirm-transaction.js（用 GET 查詢 LINE Pay 訂單狀態）
import axios from "axios";

const channelId = "2007568484";
const channelSecret = "cb183f20b331f6c246755708eef99437";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: "缺少 orderId" });

  try {
    const headers = {
      "X-LINE-ChannelId": channelId,
      "X-LINE-ChannelSecret": channelSecret,
    };

    const linepayRes = await axios.get(
      `https://api-pay.line.me/v3/payments/orders/${orderId}/check`,
      { headers }
    );

    console.log("✅ LINE Pay 查詢結果:", linepayRes.data);

    return res.status(200).json(linepayRes.data);
  } catch (err) {
    console.error("❌ LINE Pay 查詢失敗", err.response?.data || err.message);
    return res.status(500).json({ error: "查詢失敗", detail: err.message });
  }
}
