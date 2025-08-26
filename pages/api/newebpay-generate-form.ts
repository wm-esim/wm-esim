// /pages/api/newebpay-order.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios, { AxiosError } from "axios";

// 藍新金鑰
const MERCHANT_ID = "MS3788816305";
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

// WooCommerce API
const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

/* === 工具：AES 加密 + SHA256 === */
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

/* === API 主函式 === */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { items, orderInfo } = req.body as { items: any[]; orderInfo: any };
  const discount = Number(orderInfo?.discount) || 0;

  // === 計算金額 ===
  const rawAmount = items.reduce((total: number, item: any) => {
    return total + Number(item.price) * Number(item.quantity);
  }, 0);
  const amount = Math.max(Math.round(rawAmount - discount), 0); // 不允許負值
  const orderNo = `ORDER${Date.now()}`;

  /* === Step1: 建 WooCommerce 訂單 === */
  try {
    const wooPayload = {
      payment_method: "newebpay",
      payment_method_title: "藍新金流",
      set_paid: false, // 先不標記已付款
      customer_id: orderInfo?.customerId || 0,
      billing: {
        first_name: orderInfo?.name,
        email: orderInfo?.email,
        phone: orderInfo?.phone,
      },
      line_items: items.map((item: any) => {
        const lineItem: any = {
          product_id: item.id,
          quantity: item.quantity,
          meta_data: [],
          ...(item.variation_id && { variation_id: item.variation_id }),
        };
        if (item.planId) {
          lineItem.meta_data.push({ key: "esim_plan_id", value: item.planId });
        }
        return lineItem;
      }),
      coupon_lines: orderInfo?.couponCode
        ? [{ code: orderInfo.couponCode }]
        : [],
      meta_data: [
        { key: "newebpay_order_no", value: orderNo },
        { key: "discount_amount", value: discount },
        ...(orderInfo?.couponCode
          ? [{ key: "coupon_code", value: orderInfo.couponCode }]
          : []),
      ],
    };

    const wcRes = await axios.post(WOOCOMMERCE_API_URL, wooPayload, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    console.log("✅ WooCommerce 訂單建立成功：", wcRes.data?.id);
  } catch (err) {
    const error = err as AxiosError;
    const details = error.response?.data || error.message || error;
    console.error("❌ WooCommerce 訂單建立失敗：", details);
    return res.status(500).json({ error: "WooCommerce 訂單建立失敗", details });
  }

  /* === Step2: 準備藍新 MPG 參數（固定 CREDIT 信用卡） === */
  const tradeInfoObj: Record<string, string> = {
    MerchantID: MERCHANT_ID,
    RespondType: "JSON",
    TimeStamp: `${Math.floor(Date.now() / 1000)}`,
    Version: "2.0",
    MerchantOrderNo: orderNo,
    Amt: String(amount),
    ItemDesc: "虛擬商品訂單",
    Email: orderInfo?.email || "test@example.com",
    LoginType: "0",

    // ✅ 回傳網址
    ReturnURL: "https://www.wmesim.com/api/newebpay-callback",
    NotifyURL: "https://www.wmesim.com/api/newebpay-notify",
    ClientBackURL: `https://www.wmesim.com/thank-you?orderNo=${orderNo}`,

    // ✅ 固定信用卡
    PaymentMethod: "CREDIT",
    CREDIT: "1",
    VACC: "0",
    WEBATM: "0",
    CVS: "0",

    // ✅ ATM/代碼有效時間 (分鐘)，信用卡可忽略
    ExpireDate: "1440",
  };

  // MPG 要 x-www-form-urlencoded 格式字串
  const tradeInfoStr = new URLSearchParams(tradeInfoObj).toString();
  const encrypted = aesEncrypt(tradeInfoStr, HASH_KEY, HASH_IV);
  const tradeSha = shaEncrypt(encrypted, HASH_KEY, HASH_IV);

  /* === Step3: 回傳自動送出表單 === */
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
