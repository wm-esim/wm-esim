import crypto from "crypto";

export default async function handler(req, res) {
  const channelId = "2007568484";
  const channelSecret = "cb183f20b331f6c246755708eef99437";

  const { cartItems = [], totalPrice = 0, discount = 0 } = req.body;
  const orderId = "ORDER_" + Date.now();

  // ✅ 建立商品清單
  const products = cartItems.map((item, index) => ({
    id: item?.sku || `sku-${index}`,
    name: item?.name || `商品 ${index + 1}`,
    quantity: item?.quantity || 1,
    price: Math.round(item?.price || 0),
  }));

  // ✅ 如果有折扣，加一個負值商品項目
  if (discount > 0) {
    products.push({
      id: "discount",
      name: "折扣優惠",
      quantity: 1,
      price: -Math.round(discount),
    });
  }

  // ✅ 計算 LINE Pay 最終金額
  const finalAmount = products.reduce((sum, p) => sum + p.price * p.quantity, 0);

  // ✅ 防呆檢查
  if (finalAmount <= 0) {
    return res.status(400).json({ error: "付款金額需大於 0" });
  }

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
      confirmUrl: "https://www.wmesim.com/linepay-confirm", // ✅ 改為純網址（讓 LINE 自動加參數）
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

    if (result.returnCode !== "0000") {
      return res.status(400).json({
        error: "LINE Pay 預約失敗",
        detail: result.returnMessage,
        returnCode: result.returnCode,
      });
    }

    // ✅ 成功時回傳交易資訊與 orderId（前端儲存於 localStorage）
    res.status(200).json({
      ...result,
      orderId,
      amount: finalAmount,
    });
  } catch (error) {
    console.error("❌ LINE Pay Request Error:", error);
    res.status(500).json({
      error: "LINE Pay API 請求失敗",
      detail: error.message,
    });
  }
}
