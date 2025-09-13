// /pages/api/newebpay-order.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios, { AxiosError } from "axios";

// 🔐 建議改用環境變數
const MERCHANT_ID = "MS3788816305";
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

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

/* === 動態付款方式 === */
const SUPPORTED_METHODS = ["CREDIT", "VACC", "WEBATM", "CVS", "BARCODE", "LINEPAY"];

function normalizeMethods(input?: string | string[]): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(",");
  const uniq = Array.from(
    new Set(arr.map((s) => String(s).trim().toUpperCase()).filter(Boolean))
  );
  return uniq.filter((m) => SUPPORTED_METHODS.includes(m));
}

function buildFlags(methods: string[]) {
  const flags: Record<string, string> = {
    CREDIT: "0",
    VACC: "0",
    WEBATM: "0",
    CVS: "0",
    BARCODE: "0",
    LINEPAY: "0",
  };
  methods.forEach((m) => {
    if (m in flags) flags[m] = "1";
  });
  return flags;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { items, orderInfo } = req.body as { items: any[]; orderInfo: any };
  const discount = Number(orderInfo?.discount) || 0;

  // === 計算金額 ===
  const rawAmount = items.reduce((total: number, item: any) => {
    return total + Number(item.price) * Number(item.quantity);
  }, 0);
  const amount = Math.max(Math.round(rawAmount - discount), 0);
  const orderNo = `ORDER${Date.now()}`;

  /* === 付款方式決策 ===
     1) 店家白名單（環境變數設定你後台真正有開的方式）
        例：NEWEBPAY_ALLOWED_METHODS="CREDIT,VACC,WEBATM"
        （不含 CVS，就不會送 CVS）
     2) 前端本次需求（orderInfo.method / orderInfo.methods）
     最終 = 白名單 ∩ 本次需求；若本次沒指定，採用白名單。若交集為空，退回 ["CREDIT"]。
  */
  const envAllowedRaw = process.env.NEWEBPAY_ALLOWED_METHODS || "CREDIT,VACC,WEBATM";
  const envAllowed = normalizeMethods(envAllowedRaw);
  const requested = normalizeMethods(orderInfo?.methods ?? orderInfo?.method);
  const chosen = (requested.length
    ? envAllowed.filter((m) => requested.includes(m))
    : envAllowed
  );
  const methods = chosen.length ? chosen : ["CREDIT"];
  const flags = buildFlags(methods);
  const paymentMethodValue = methods.join(",");

  /* === Step1: 建 WooCommerce 訂單 === */
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
        if (item.planId) lineItem.meta_data.push({ key: "esim_plan_id", value: item.planId });
        return lineItem;
      }),
      coupon_lines: orderInfo?.couponCode ? [{ code: orderInfo.couponCode }] : [],
      meta_data: [
        { key: "newebpay_order_no", value: orderNo },
        { key: "discount_amount", value: discount },
        { key: "newebpay_payment_methods", value: paymentMethodValue },
        ...(orderInfo?.couponCode ? [{ key: "coupon_code", value: orderInfo.couponCode }] : []),
      ],
    };

    await axios.post(WOOCOMMERCE_API_URL, wooPayload, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });
  } catch (err) {
    const error = err as AxiosError;
    const details = (error.response?.data as any) || error.message || error;
    console.error("❌ WooCommerce 訂單建立失敗：", details);
    return res.status(500).json({ error: "WooCommerce 訂單建立失敗", details });
  }

  /* === Step2: 準備藍新 MPG 參數（動態） === */
  const needExpire = methods.some((m) => ["VACC", "CVS", "BARCODE"].includes(m));
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

    ReturnURL: "https://www.wmesim.com/api/newebpay-callback/",
    NotifyURL: "https://www.wmesim.com/api/newebpay-notify/",
   ClientBackURL: `https://www.wmesim.com/thank-you?orderNo=${orderNo}`,


    // ✅ 動態付款方式
    PaymentMethod: paymentMethodValue,
    CREDIT: flags.CREDIT,
    VACC: flags.VACC,
    WEBATM: flags.WEBATM,
    CVS: flags.CVS,        // 若白名單不含，會是 "0"
    BARCODE: flags.BARCODE,
    LINEPAY: flags.LINEPAY,

    ...(needExpire ? { ExpireDate: String(orderInfo?.expireMinutes ?? 1440) } : {}),
  };

  //（上線後可移除）檢查參數，避免誤送 CVS
  // console.log("[MPG params]", tradeInfoObj);

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
