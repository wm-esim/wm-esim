import crypto from "crypto";

export default async function handler(req, res) {
  const channelId = "2007568484";
  const channelSecret = "cb183f20b331f6c246755708eef99437";

  const { cartItems, totalPrice = 0, discount = 0 } = req.body;
  const finalAmount = Math.max(Math.round(totalPrice - discount), 1); // 避免負數或 0

  const orderId = "ORDER_" + Date.now();

  const products = cartItems.map((item, index) => ({
    id: item.sku || `sku-${index}`,
    name: item.name || `商品 ${index + 1}`,
    quantity: item.quantity || 1,
    price: Math.round(item.price || 0),
  }));

  const body = {
    amount: finalAmount,
    currency: "TWD",
    orderId,
    packages: [
      {
        id: "pkg_" + Date.now(),
        amount: finalAmount,
        name: "汪喵通SIM",
        products,
      },
    ],
    redirectUrls: {
      confirmUrl: `https://www.wmesim.com/linepay-confirm?orderId=${orderId}&amount=${finalAmount}`,
      cancelUrl: "https://www.wmesim.com/linepay-cancel",
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
    console.log("✅ LINE Pay 預約結果：", result);

    res.status(response.status).json({ ...result, orderId });
  } catch (error) {
    console.error("❌ LINE Pay Request Error:", error);
    res.status(500).json({ error: "LINE Pay API 請求失敗", detail: error.message });
  }
}
