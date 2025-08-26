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

  const { items, orderInfo } = req.body as { items: any[]; orderInfo: any };
  const discount = Number(orderInfo?.discount) || 0;

  // --- 計算金額 ---
  const rawAmount = items.reduce((total: number, item: any) => {
    return total + Number(item.price) * Number(item.quantity);
  }, 0);
  const amount = Math.max(Math.round(rawAmount - discount), 0); // 不允許負值
  const orderNo = `ORDER${Date.now()}`;

  // --- 依前端選擇決定藍新付款方式 ---
  const pm = String(orderInfo?.paymentMethod || "").toLowerCase(); // "credit" | "atm" | "webatm" | "cvs" | ""
  type Flags = { CREDIT: 0 | 1; VACC: 0 | 1; WEBATM: 0 | 1; CVS: 0 | 1 };
  let flags: Flags = { CREDIT: 1, VACC: 1, WEBATM: 1, CVS: 1 }; // 預設全開
  let selectedPaymentCode = "MULTI"; // 寫進 Woo 供前台顯示

  switch (pm) {
    case "credit":
      flags = { CREDIT: 1, VACC: 0, WEBATM: 0, CVS: 0 };
      selectedPaymentCode = "CREDIT";
      break;
    case "atm":
      flags = { CREDIT: 0, VACC: 1, WEBATM: 0, CVS: 0 };
      selectedPaymentCode = "VACC";
      break;
    case "webatm":
      flags = { CREDIT: 0, VACC: 0, WEBATM: 1, CVS: 0 };
      selectedPaymentCode = "WEBATM";
      break;
    case "cvs":
      flags = { CREDIT: 0, VACC: 0, WEBATM: 0, CVS: 1 };
      selectedPaymentCode = "CVS";
      break;
    default:
      // MULTI: 四種都開
      selectedPaymentCode = "MULTI";
  }

  // --- 建立 Woo 訂單（把選到的付款型別也寫進 meta）---
  try {
    const wooPayload = {
      payment_method: "newebpay",
      payment_method_title: "藍新金流",
      set_paid: false,
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
        { key: "newebpay_payment_type", value: selectedPaymentCode }, // ← 新增：記錄使用者選擇
        ...(orderInfo?.couponCode ? [{ key: "coupon_code", value: orderInfo.couponCode }] : []),
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

  // --- 藍新 MPG 參數（依 flags 開啟對應付款方式） ---
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

    // 回傳與背景通知
    ReturnURL: "https://www.wmesim.com/api/newebpay-return/",
    NotifyURL: "https://www.wmesim.com/api/newebpay-notify/",
    ClientBackURL: "https://www.wmesim.com/thank-you/",
  };

  // 依使用者選擇設定付款旗標
  tradeInfoObj.CREDIT = String(flags.CREDIT);
  tradeInfoObj.WEBATM = String(flags.WEBATM);
  tradeInfoObj.VACC = String(flags.VACC);
  tradeInfoObj.CVS = String(flags.CVS);

  // （選用）代碼/虛擬帳號有效時間（分鐘）— 如不需要可移除
  // 注意：實際參數名稱/格式請以藍新文件為準
  tradeInfoObj.ExpireDate = String(1440); // 24 小時

  // MPG 需要 x-www-form-urlencoded 格式字串
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
