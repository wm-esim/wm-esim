// /pages/api/newebpay-order.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios, { AxiosError } from "axios";

// 🔐 建議改用環境變數（先沿用你現在硬寫的）
const MERCHANT_ID = "MS3788816305";
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

// ✅ 只取 id，避免 Woo 在回傳 response 時 format 爆炸
const WOOCOMMERCE_API_URL =
  "https://fegoesim.com/wp-json/wc/v3/orders?_fields=id";

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

/** yyyymmdd / hhmmss */
function formatExpire(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  const SS = pad(d.getSeconds());
  return { ExpireDate: `${yyyy}${mm}${dd}`, ExpireTime: `${HH}${MM}${SS}` };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { items, orderInfo } = req.body as { items: any[]; orderInfo: any };

  // ✅ 基本防呆
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items is empty" });
  }
  if (!orderInfo?.name || !orderInfo?.email || !orderInfo?.phone) {
    return res.status(400).json({ error: "missing required orderInfo fields" });
  }

  const discount = Number(orderInfo?.discount) || 0;

  // === 計算金額 ===
  const rawAmount = items.reduce((total: number, item: any) => {
    return total + Number(item.price) * Number(item.quantity);
  }, 0);
  const amount = Math.max(Math.round(rawAmount - discount), 0);
  const orderNo = `ORDER${Date.now()}`;

  /* === 付款方式決策 === */
  const envAllowedRaw = process.env.NEWEBPAY_ALLOWED_METHODS || "CREDIT,VACC,WEBATM";
  const envAllowed = normalizeMethods(envAllowedRaw);
  const requested = normalizeMethods(orderInfo?.methods ?? orderInfo?.method);
  const chosen = requested.length ? envAllowed.filter((m) => requested.includes(m)) : envAllowed;
  const methods = chosen.length ? chosen : ["CREDIT"];
  const flags = buildFlags(methods);
  const paymentMethodValue = methods.join(",");

  /* === Step1: 建 WooCommerce 訂單 === */
  let wooOrderId: number | null = null;

  try {
    // ✅ 只送最小必要欄位，避免 Woo 內部 calculate / format 時被外掛搞壞
    const wooPayload: any = {
      payment_method: "newebpay",
      payment_method_title: "藍新金流",
      set_paid: false,
      customer_id: Number(orderInfo?.customerId || 0),

      billing: {
        first_name: String(orderInfo?.name || ""),
        email: String(orderInfo?.email || ""),
        phone: String(orderInfo?.phone || ""),
      },

      // ✅ 強制轉 number，避免傳到 Woo 變成奇怪型別
      line_items: items.map((item: any) => {
        const productId = Number(item.id);
        const qty = Math.max(1, Number(item.quantity || 1));

        const lineItem: any = {
          product_id: productId,
          quantity: qty,
          meta_data: [],
        };

        // variation_id 若有
        if (item.variation_id) lineItem.variation_id = Number(item.variation_id);

        // eSIM plan id
        if (item.planId) {
          lineItem.meta_data.push({ key: "esim_plan_id", value: String(item.planId) });
        }

        return lineItem;
      }),

      // ✅ 關鍵：不要讓 Woo 套用 coupon（你已自己算折扣）
      // coupon_lines: [],

      meta_data: [
        { key: "newebpay_order_no", value: orderNo },
        { key: "discount_amount", value: Number(discount) },
        { key: "newebpay_payment_methods", value: paymentMethodValue },
        { key: "coupon_code", value: String(orderInfo?.couponCode || "") },
        { key: "computed_amount", value: String(amount) },
      ],
    };

    const wooRes = await axios.post(WOOCOMMERCE_API_URL, wooPayload, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
    });

    wooOrderId = Number((wooRes.data as any)?.id || 0) || null;

    if (!wooOrderId) {
      console.error("❌ Woo order created but no id returned:", wooRes.data);
      return res.status(500).json({
        error: "WooCommerce 訂單建立失敗",
        details: "Woo order created but id missing",
      });
    }
  } catch (err) {
    const error = err as AxiosError;
    const details = (error.response?.data as any) || error.message || error;
    console.error("❌ WooCommerce 訂單建立失敗：", details);
    return res.status(500).json({ error: "WooCommerce 訂單建立失敗", details });
  }

  /* === Step2: 準備藍新 MPG 參數（動態） === */
  const needExpire = methods.some((m) => ["VACC", "CVS", "BARCODE"].includes(m));
  const expireMinutes = Number(orderInfo?.expireMinutes ?? 1440);
  const { ExpireDate, ExpireTime } = needExpire
    ? formatExpire(Date.now() + Math.max(1, expireMinutes) * 60 * 1000)
    : { ExpireDate: undefined, ExpireTime: undefined };

  const tradeInfoObj: Record<string, string> = {
    MerchantID: MERCHANT_ID,
    RespondType: "JSON",
    TimeStamp: `${Math.floor(Date.now() / 1000)}`,
    Version: "2.3",
    MerchantOrderNo: orderNo,
    Amt: String(amount),
    ItemDesc: "虛擬商品訂單",
    Email: orderInfo?.email || "test@example.com",

    // 回傳/通知
    ReturnURL: "https://www.wmesim.com/api/newebpay-callback/",
    NotifyURL: "https://www.wmesim.com/api/newebpay-notify/",
    CustomerURL: `https://www.wmesim.com/api/newebpay-customer?orderNo=${encodeURIComponent(orderNo)}`,
    ClientBackURL: `https://www.wmesim.com/thank-you?orderNo=${encodeURIComponent(orderNo)}`,

    PaymentMethod: paymentMethodValue,
    CREDIT: flags.CREDIT,
    VACC: flags.VACC,
    WEBATM: flags.WEBATM,
    CVS: flags.CVS,
    BARCODE: flags.BARCODE,
    LINEPAY: flags.LINEPAY,
  };

  if (needExpire && ExpireDate && ExpireTime) {
    (tradeInfoObj as any).ExpireDate = ExpireDate;
    (tradeInfoObj as any).ExpireTime = ExpireTime;
  }

  const tradeInfoStr = new URLSearchParams(tradeInfoObj).toString();
  const encrypted = aesEncrypt(tradeInfoStr, HASH_KEY, HASH_IV);
  const tradeSha = shaEncrypt(encrypted, HASH_KEY, HASH_IV);

  /* === Step3: 回傳自動送出表單 === */
  const html = `
<form id="newebpay-form" method="post" action="https://core.newebpay.com/MPG/mpg_gateway">
  <input type="hidden" name="MerchantID" value="${MERCHANT_ID}" />
  <input type="hidden" name="TradeInfo" value="${encrypted}" />
  <input type="hidden" name="TradeSha" value="${tradeSha}" />
  <input type="hidden" name="Version" value="2.3" />
</form>
<script>
  try {
    var payload = { orderNo: ${JSON.stringify(orderNo)}, wooOrderId: ${JSON.stringify(wooOrderId)}, ts: Date.now() };
    localStorage.setItem("lastOrderNo", ${JSON.stringify(orderNo)});
    localStorage.setItem("lastOrderNoPayload", JSON.stringify(payload));
  } catch(e) {}
  document.getElementById("newebpay-form").submit();
</script>
`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}
