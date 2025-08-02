// /api/linepay/linepay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import qs from "qs";
import nodemailer from "nodemailer";

// LINE Pay 設定
const channelId = "2007568484";
const channelSecret = "cb183f20b331f6c246755708eef99437";

// WooCommerce 設定
const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

// eSIM QRCode API
const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

// ezPay 設定
const INVOICE_API_URL = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV = "PtgsjF33nlm8q2kC";

// SMTP 寄信設定
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: "your-email@gmail.com",        // TODO: 改為你自己的寄件人帳號
    pass: "your-app-password",           // TODO: 改為 Gmail App Password
  },
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { transactionId, orderId } = req.query;

  if (!transactionId || typeof transactionId !== "string") {
    return res.status(400).json({ error: "缺少 transactionId" });
  }

  if (!orderId || typeof orderId !== "string") {
    return res.status(400).json({ error: "缺少 orderId" });
  }

  // 🔐 建立 LINE Pay 簽章
  const uri = `/v3/payments/${transactionId}/confirm`;
  const body = { amount: 100, currency: "TWD" };
  const rawBody = JSON.stringify(body);
  const nonce = crypto.randomUUID();
  const signature = crypto
    .createHmac("sha256", channelSecret)
    .update(channelSecret + uri + rawBody + nonce)
    .digest("base64");

  try {
    // ✅ 確認付款
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
      return res.status(400).json({ error: "付款確認失敗", detail: confirmData });
    }

    // ✅ 建立 WooCommerce 訂單
    const wcOrder = await axios.post(
      WOOCOMMERCE_API_URL,
      {
        payment_method: "linepay",
        payment_method_title: "LINE Pay",
        set_paid: true,
        billing: {
          first_name: "LinePay",
          email: "user@example.com", // TODO: 前端 checkout 時傳入客戶 email 並附在 ?orderId=...&transactionId=...&email=
        },
        line_items: [{ product_id: 123, quantity: 1 }], // TODO: 換成實際商品 ID 與數量
        customer_note: `LINE Pay 訂單 ${transactionId}`,
      },
      {
        auth: {
          username: CONSUMER_KEY,
          password: CONSUMER_SECRET,
        },
      }
    );

    const wcOrderId = wcOrder.data.id;

    // ✅ 取得 QRCode
    const qrRes = await axios.post(ESIM_PROXY_URL, { orderId: wcOrderId });
    const qrUrl = qrRes.data?.qrCodeUrl || "未產生 QRCode";

    // ✅ 寫入訂單備註
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

    // ✅ 發送 Email
    await transporter.sendMail({
      from: "汪喵通 SIM <your-email@gmail.com>",
      to: "user@example.com", // TODO: 改為實際 email
      subject: "您的 eSIM QRCode",
      html: `<p>感謝您的購買！以下是您的 QRCode：</p><img src="${qrUrl}" width="200" />`,
    });

    // ✅ 開立電子發票
    const invoiceData = {
      RespondType: "JSON",
      Version: "1.4",
      TimeStamp: Date.now().toString(),
      MerchantOrderNo: `INV${Date.now()}`,
      Status: "1",
      Category: "B2C",
      BuyerEmail: "user@example.com",
      PrintFlag: "N",
      TaxType: "1",
      TaxRate: "5",
      Amt: "100",
      TaxAmt: "5",
      TotalAmt: "105",
      ItemName: "eSIM",
      ItemCount: "1",
      ItemUnit: "組",
      ItemPrice: "100",
      ItemAmt: "100",
    };

    const encrypted = encryptAES(invoiceData, INVOICE_HASH_KEY, INVOICE_HASH_IV);
    const invoiceRes = await axios.post(
      INVOICE_API_URL,
      qs.stringify({
        MerchantID_: INVOICE_MERCHANT_ID,
        PostData_: encrypted,
      })
    );

    console.log("✅ 發票回傳結果：", invoiceRes.data);

    // ✅ 完成導向 Thank You 頁面
    return res.redirect(`/thank-you?order=${wcOrderId}`);
  } catch (err: any) {
    console.error("❌ LINE Pay Callback 錯誤", err);
    return res
      .status(500)
      .json({ error: "LINE Pay Callback 發生錯誤", detail: err.message });
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
