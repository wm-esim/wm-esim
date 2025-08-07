import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import qs from "qs";
import nodemailer from "nodemailer";

// LINE Pay 設定
const channelId = "2007568484";
const channelSecret = "cb183f20b331f6c246755708eef99437";

// WooCommerce 設定（你提供的）
const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

// eSIM QRCode Proxy
const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

// ezPay 發票設定
const INVOICE_API_URL = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV = "PtgsjF33nlm8q2kC";

// 建立 SMTP 寄件者
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "wandmesim@gmail.com",
    pass: "hwoywmluqvsuluss",
  },
});

// ✅ 抽出發送 eSIM Mail 函式
async function sendEsimEmail(to: string, orderNumber: string, imagesHtml: string) {
  await transporter.sendMail({
    from: "汪喵通 SIM <wandmesim@gmail.com>",
    to,
    subject: `您的訂單 ${orderNumber} 的 eSIM QRCode`,
    html: `
      <p>親愛的顧客您好，</p>
      <p>感謝您透過 LINE Pay 付款。以下是您的 eSIM QRCode：</p>
      ${imagesHtml}
      <p>若有問題請聯繫客服，我們將竭誠協助您。</p>
    `,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { transactionId, orderId, email } = req.query;

  if (!transactionId || !orderId || !email) {
    return res.status(400).json({ error: "缺少必要參數 transactionId/orderId/email" });
  }

  const finalAmount = Number(orderId.toString().split("_")[1]?.slice(-3)) || 100;
  const uri = `/v3/payments/${transactionId}/confirm`;
  const body = { amount: finalAmount, currency: "TWD" };
  const rawBody = JSON.stringify(body);
  const nonce = crypto.randomUUID();
  const signature = crypto
    .createHmac("sha256", channelSecret)
    .update(channelSecret + uri + rawBody + nonce)
    .digest("base64");

  try {
    // 1️⃣ 確認 LINE Pay 付款
    const confirmRes = await fetch(`https://api-pay.line.me${uri}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LINE-ChannelId": channelId,
        "X-LINE-Authorization-Nonce": nonce,
        "X-LINE-Authorization": signature,
      },
      body: rawBody,
    });

    const confirmData = await confirmRes.json();
    if (confirmData.returnCode !== "0000") {
      return res.status(400).json({ error: "付款失敗", detail: confirmData });
    }

    // 2️⃣ 建立 WooCommerce 訂單
    const orderRes = await axios.post(
      WOOCOMMERCE_API_URL,
      {
        payment_method: "linepay",
        payment_method_title: "LINE Pay",
        set_paid: true,
        billing: {
          first_name: "LinePay",
          email: email.toString(),
        },
        line_items: [{ product_id: 123, quantity: 1 }], // ✅ 改為真實品項
        meta_data: [
          { key: "linepay_transaction_id", value: transactionId },
        ],
        customer_note: `LINE Pay 訂單`,
      },
      {
        auth: {
          username: CONSUMER_KEY,
          password: CONSUMER_SECRET,
        },
      }
    );

    const wcOrder = orderRes.data;
    const wcOrderId = wcOrder.id;
    const orderNumber = wcOrder.number;

    // 3️⃣ 取得 eSIM QRCode
    const qrRes = await axios.post(ESIM_PROXY_URL, { orderId: wcOrderId });
    const qrUrl = qrRes.data?.qrCodeUrl || "";
    const imagesHtml = qrUrl ? `<img src="${qrUrl}" width="200" />` : "（無法取得 QRCode）";

    // 4️⃣ 寫入備註
    await axios.post(
      `${WOOCOMMERCE_API_URL}/${wcOrderId}/notes`,
      { note: `eSIM QRCode: ${qrUrl}` },
      {
        auth: {
          username: CONSUMER_KEY,
          password: CONSUMER_SECRET,
        },
      }
    );

    // 5️⃣ 發送 Email
    await sendEsimEmail(email.toString(), orderNumber, imagesHtml);

    // 6️⃣ ezPay 發票
    const amt = Math.round(finalAmount / 1.05);
    const taxAmt = finalAmount - amt;

    const invoiceData = {
      RespondType: "JSON",
      Version: "1.4",
      TimeStamp: Date.now().toString(),
      MerchantOrderNo: `INV${Date.now()}`,
      Status: "1",
      Category: "B2C",
      BuyerEmail: email.toString(),
      PrintFlag: "N",
      TaxType: "1",
      TaxRate: "5",
      Amt: amt.toString(),
      TaxAmt: taxAmt.toString(),
      TotalAmt: finalAmount.toString(),
      ItemName: "eSIM",
      ItemCount: "1",
      ItemUnit: "組",
      ItemPrice: amt.toString(),
      ItemAmt: amt.toString(),
    };

    const encrypted = encryptAES(invoiceData, INVOICE_HASH_KEY, INVOICE_HASH_IV);
    const invoiceRes = await axios.post(
      INVOICE_API_URL,
      qs.stringify({ MerchantID_: INVOICE_MERCHANT_ID, PostData_: encrypted })
    );

    console.log("✅ ezPay 發票回傳：", invoiceRes.data);

    return res.redirect(`/thank-you?order=${wcOrderId}`);
  } catch (err: any) {
    console.error("❌ LINE Pay Callback 錯誤", err);
    return res.status(500).json({ error: "LINE Pay Callback 發生錯誤", detail: err.message });
  }
}

// AES 加密
function encryptAES(data: any, key: string, iv: string) {
  const text = qs.stringify(data);
  const cipher = crypto.createCipheriv("aes-256-cbc", key.padEnd(32, " "), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}
