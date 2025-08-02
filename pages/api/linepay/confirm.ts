import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";

const channelId = "2007568484";
const channelSecret = "cb183f20b331f6c246755708eef99437";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { transactionId, amount } = req.body;

  if (!transactionId || !amount) {
    return res.status(400).json({ error: "缺少必要參數 transactionId 或 amount" });
  }

  const uri = `/v3/payments/${transactionId}/confirm`;
  const body = {
    amount: Number(amount), // ✅ 確保是數字
    currency: "TWD",
  };

  const rawBody = JSON.stringify(body);
  const nonce = crypto.randomUUID();
  const stringToSign = channelSecret + uri + rawBody + nonce;

  const signature = crypto
    .createHmac("sha256", channelSecret)
    .update(stringToSign)
    .digest("base64");

  console.log("🧪 發送 confirm 請求內容：", {
    transactionId,
    amount,
    uri,
    rawBody,
    nonce,
    signature,
  });

  try {
    const response = await fetch(`https://api-pay.line.me${uri}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LINE-ChannelId": channelId,
        "X-LINE-Authorization-Nonce": nonce,
        "X-LINE-Authorization": signature,
      },
      body: rawBody,
    });

    const result = await response.json();
    console.log("✅ LINE Pay confirm 回傳結果：", result);

    return res.status(response.status).json(result);
  } catch (error: any) {
    console.error("❌ 發送 confirm 發生錯誤", error);
    return res.status(500).json({ error: "LINE Pay confirm 發生錯誤", detail: error.message });
  }
}
