import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios, { AxiosError } from "axios";

const MERCHANT_ID = "MS3788816305";
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

function aesEncrypt(data: string, key: string, iv: string) {
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8")
  );
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

function shaEncrypt(encryptedText: string, key: string, iv: string) {
  const plainText = `HashKey=${key}&${encryptedText}&HashIV=${iv}`;
  return crypto.createHash("sha256").update(plainText).digest("hex").toUpperCase();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

const { items, orderInfo } = req.body;
const discount = Number(orderInfo?.discount) || 0;

  console.log("🛒 items:", items);
  console.log("🧾 orderInfo:", orderInfo);
  console.log("💸 discount:", discount);

  const rawAmount = items.reduce((total: number, item: any) => {
    return total + Number(item.price) * Number(item.quantity);
  }, 0);

  const amount = Math.max(Math.round(rawAmount - Number(discount)), 0); // 不允許負值


  const orderNo = `ORDER${Date.now()}`;

  try {
    const wooPayload = {
  payment_method: "newebpay",
  payment_method_title: "藍新金流",
  set_paid: false,
  customer_id: orderInfo.customerId || 0,
  billing: {
    first_name: orderInfo.name,
    email: orderInfo.email,
    phone: orderInfo.phone,
  },
  line_items: items.map((item: any) => {
    const lineItem: any = {
      product_id: item.id,
      quantity: item.quantity,
      meta_data: [],
      ...(item.variation_id && { variation_id: item.variation_id }),
    };

    if (item.planId) {
      lineItem.meta_data.push({
        key: "esim_plan_id",
        value: item.planId,
      });
    }

    return lineItem;
  }),
  coupon_lines: orderInfo.couponCode
    ? [
        {
          code: orderInfo.couponCode, // ✅ 這一行會觸發 WooCommerce 自動套用優惠券邏輯
        },
      ]
    : [],
  meta_data: [
    { key: "newebpay_order_no", value: orderNo },
    { key: "discount_amount", value: discount },
    ...(orderInfo.couponCode
      ? [{ key: "coupon_code", value: orderInfo.couponCode }]
      : []),
  ],
};


    console.log("📦 即將傳送至 WooCommerce 的訂單資料：", JSON.stringify(wooPayload, null, 2));

    const wcRes = await axios.post(WOOCOMMERCE_API_URL, wooPayload, {
      auth: {
        username: CONSUMER_KEY,
        password: CONSUMER_SECRET,
      },
    });

    console.log("✅ WooCommerce 訂單建立成功：", wcRes.data);
  } catch (err) {
    const error = err as AxiosError;
    const details = error.response?.data || error.message || error;
    console.error("❌ WooCommerce 訂單建立失敗：", details);
    return res.status(500).json({ error: "WooCommerce 訂單建立失敗", details });
  }

  // ✅ 建立藍新付款參數
  const tradeInfoObj = {
    MerchantID: MERCHANT_ID,
    RespondType: "JSON",
    TimeStamp: `${Math.floor(Date.now() / 1000)}`,
    Version: "2.0",
    MerchantOrderNo: orderNo,
    Amt: String(amount),
    ItemDesc: "虛擬商品訂單",
    Email: orderInfo.email || "test@example.com",
    LoginType: "0",
    ReturnURL: "https://www.wmesim.com/api/newebpay-callback",
    NotifyURL: "https://www.wmesim.com/api/newebpay-notify",
    ClientBackURL: "https://www.wmesim.com/thank-you",
    PaymentMethod: "CREDIT",
  };

  const tradeInfoStr = new URLSearchParams(tradeInfoObj).toString();
  const encrypted = aesEncrypt(tradeInfoStr, HASH_KEY, HASH_IV);
  const tradeSha = shaEncrypt(encrypted, HASH_KEY, HASH_IV);

  const html = `
    <form id="newebpay-form" method="post" action="https://core.newebpay.com/MPG/mpg_gateway">
      <input type="hidden" name="MerchantID" value="${MERCHANT_ID}" />
      <input type="hidden" name="TradeInfo" value="${encrypted}" />
      <input type="hidden" name="TradeSha" value="${tradeSha}" />
      <input type="hidden" name="Version" value="2.0" />
    </form>
    <script>document.getElementById("newebpay-form").submit();</script>
  `;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
}
