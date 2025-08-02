// pages/api/linepay/reserve.js

import crypto from "crypto";

export default async function handler(req, res) {
  const channelId = "2007568484";
  const channelSecret = "cb183f20b331f6c246755708eef99437";

  const { cartItems, totalPrice = 100 } = req.body; // fallback 為 100 元
  const orderId = "ORDER_" + Date.now(); // 動態唯一訂單編號

  // 建立商品清單
  const products = cartItems.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    price: item.price,
  }));

  const body = {
    amount: totalPrice,
    currency: "TWD",
    orderId,
    packages: [
      {
        id: "pkg_" + Date.now(),
        amount: totalPrice,
        name: "汪喵通SIM",
        products,
      },
    ],
    redirectUrls: {
      confirmUrl: "https://esim-beta.vercel.app/linepay-confirm",
      cancelUrl: "https://esim-beta.vercel.app/linepay-cancel",
    },
  };

  const rawBody = JSON.stringify(body);
  const uri = "/v3/payments/request";
  const nonce = crypto.randomUUID();
  const stringToSign = channelSecret + uri + rawBody + nonce;

  const signature = crypto
    .createHmac("sha256", channelSecret)
    .update(stringToSign)
    .digest("base64");

  try {
    const response = await fetch("https://api-pay.line.me/v3/payments/request", {
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
    res.status(response.status).json(result);
  } catch (error) {
    console.error("LINE Pay Request Error:", error);
    res.status(500).json({ error: "LINE Pay API 請求失敗" });
  }
}
