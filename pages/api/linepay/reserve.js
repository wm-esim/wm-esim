import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const channelId = "2007568484";
  const channelSecret = "cb183f20b331f6c246755708eef99437";

  const { cartItems, totalPrice = 100 } = req.body;
  const orderId = "ORDER_" + Date.now();

  const products = cartItems.map((item, index) => ({
    id: item.sku || `sku-${index}`,
    name: item.name || `商品 ${index + 1}`,
    quantity: item.quantity || 1,
    price: Math.round(item.price || 0),
  }));

  const body = {
    amount: Math.round(totalPrice),
    currency: "TWD",
    orderId,
    packages: [
      {
        id: "pkg_" + Date.now(),
        amount: Math.round(totalPrice),
        name: "汪喵通SIM",
        products,
      },
    ],
    redirectUrls: {
      confirmUrl: "https://www.wmesim.com/linepay-confirm",
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
    console.error("LINE Pay 請求錯誤:", error);
    res.status(500).json({ error: "LINE Pay API 請求失敗", detail: error.message });
  }
}
