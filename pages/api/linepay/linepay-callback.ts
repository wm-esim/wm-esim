// /api/linepay/linepay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import qs from "qs";
import nodemailer from "nodemailer";

// LINE Pay 設定
const channelId = "2007568484";
const channelSecret = "cb183f20b331f6c246755708eef99437";

// WooCommerce
const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

// eSIM QRCode Proxy
const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

// ezPay 發票
const INVOICE_API_URL = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV = "PtgsjF33nlm8q2kC";

// 建立寄件者
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "wandmesim@gmail.com",
    pass: "hwoywmluqvsuluss",
  },
});

function encryptAES(data: any, key: string, iv: string) {
  const text = qs.stringify(data);
  const cipher = crypto.createCipheriv("aes-256-cbc", key.padEnd(32, " "), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { transactionId, orderId, amount, email, cartItems } = req.body;
  // ✅ Debug log
  console.log("📦 Received callback payload:", {
    transactionId,
    orderId,
    amount,
    email,
    cartItems,
  });
  if (!transactionId || !orderId || !amount || !email || !cartItems) {
    return res.status(400).json({ error: "缺少必要欄位" });
  }

  // Confirm LINE Pay 付款
  const uri = `/v3/payments/${transactionId}/confirm`;
  const rawBody = JSON.stringify({ amount, currency: "TWD" });
  const nonce = crypto.randomUUID();
  const signature = crypto
    .createHmac("sha256", channelSecret)
    .update(channelSecret + uri + rawBody + nonce)
    .digest("base64");

  try {
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
    console.log("✅ LINE Pay confirm 回傳結果: ", confirmData);

    if (confirmData.returnCode !== "0000") {
      return res.status(400).json({ error: "付款失敗", detail: confirmData });
    }

    // WooCommerce 建立訂單
    const wcOrderRes = await axios.post(
      WOOCOMMERCE_API_URL,
      {
        payment_method: "linepay",
        payment_method_title: "LINE Pay",
        set_paid: true,
        billing: {
          first_name: "LinePay",
          email,
        },
        line_items: cartItems.map((item: any) => ({
          product_id: item.id,
          quantity: item.quantity,
        })),
        meta_data: [{ key: "linepay_transaction_id", value: transactionId }],
        customer_note: `LINE Pay 訂單 ${transactionId}`,
      },
      {
        auth: {
          username: CONSUMER_KEY,
          password: CONSUMER_SECRET,
        },
      }
    );

    const wcOrder = wcOrderRes.data;
    const wcOrderId = wcOrder.id;
    const orderNumber = wcOrder.number;

    // 取得 QRCode
    const qrRes = await axios.post(ESIM_PROXY_URL, { orderId: wcOrderId });
    const qrUrl = qrRes.data?.qrCodeUrl || "";
    const imagesHtml = qrUrl ? `<img src="${qrUrl}" width="200" />` : "";

    // 寫入備註
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

    // 寄出 email
    await transporter.sendMail({
      from: "汪喵通 SIM <wandmesim@gmail.com>",
      to: email,
      subject: `您的訂單 ${orderNumber} 的 eSIM QRCode`,
      html: `<p>感謝您的購買，以下為 QRCode：</p>${imagesHtml}`,
    });

    // 開立發票
    const amt = Math.round(amount / 1.05);
    const taxAmt = amount - amt;

    const invoiceData = {
      RespondType: "JSON",
      Version: "1.4",
      TimeStamp: Date.now().toString(),
      MerchantOrderNo: `INV${Date.now()}`,
      Status: "1",
      Category: "B2C",
      BuyerEmail: email,
      PrintFlag: "N",
      TaxType: "1",
      TaxRate: "5",
      Amt: amt.toString(),
      TaxAmt: taxAmt.toString(),
      TotalAmt: amount.toString(),
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

    console.log("✅ 發票開立成功：", invoiceRes.data);

    // 完成
    return res.redirect(`/thank-you?order=${wcOrderId}`);
  } catch (err: any) {
    console.error("❌ LINE Pay Callback 錯誤", err);
    return res.status(500).json({ error: "LINE Pay Callback 發生錯誤", detail: err.message });
  }
}
