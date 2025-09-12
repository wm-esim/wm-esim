import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios, { AxiosError } from "axios";

const MERCHANT_ID = "MS3788816305";
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

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

  const { items, orderInfo } = req.body as {
    items: Array<any>;
    orderInfo: any;
  };
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
              code: orderInfo.couponCode, // ✅ 讓 Woo 自動套用優惠券
            },
          ]
        : [],
      meta_data: [
        { key: "newebpay_order_no", value: orderNo },
        { key: "discount_amount", value: discount },
        ...(orderInfo.couponCode ? [{ key: "coupon_code", value: orderInfo.couponCode }] : []),
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

  // ✅ 建立藍新付款參數（開啟信用卡 / ATM 虛擬帳號 / WebATM / 超商代碼）
  const tradeInfoObj: Record<string, string | number> = {
    MerchantID: MERCHANT_ID,
    RespondType: "JSON",
    TimeStamp: `${Math.floor(Date.now() / 1000)}`,
    Version: "2.0",
    MerchantOrderNo: orderNo,
    Amt: String(amount),
    ItemDesc: "虛擬商品訂單",
    Email: orderInfo.email || "test@example.com",
    LoginType: "0",

    // 🔔 回傳（前端導回）與背景通知
    ReturnURL: "https://www.wmesim.com/api/newebpay-return/",
    NotifyURL: "https://www.wmesim.com/api/newebpay-notify/",
    ClientBackURL: "https://www.wmesim.com/thank-you/",

    // ✅ 多付款方式旗標（1 = 啟用）
    CREDIT: 1,
    WEBATM: 1,
    VACC: 1,
    CVS: 1,

    // (選用) 代碼/虛擬帳號有效期限（單位：分鐘）。這裡示範 1440 分 = 24 小時
    // 可依你的商務需求調整或移除
    ExpireDate: 1440,
  };

  // 注意：URLSearchParams 會把 number 轉成字串，符合 MPG 需求
  const tradeInfoStr = new URLSearchParams(
    Object.entries(tradeInfoObj).reduce((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {} as Record<string, string>)
  ).toString();

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
