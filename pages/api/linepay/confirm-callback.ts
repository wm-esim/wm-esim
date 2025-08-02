// pages/api/linepay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import crypto from "crypto";
import nodemailer from "nodemailer";
import qs from "qs";

// WooCommerce 設定
const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

// eSIM 設定
const ESIM_PROXY_URL = "https://esim-beta.vercel.app/api/esim/qrcode";
const PLAN_ID_MAP: Record<string, string> = {
  "Malaysia-Daily500MB-1-A0": "90ab730c-b369-4144-a6f5-be4376494791",
};

// ezPay 設定
const INVOICE_API_URL = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV = "PtgsjF33nlm8q2qC";

// 工具：產生發票 CheckCode
function genCheckCode(params: Record<string, string>): string {
  const raw = `HashKey=${INVOICE_HASH_KEY}&Amt=${params.Amt}&MerchantID=${params.MerchantID}&MerchantOrderNo=${params.MerchantOrderNo}&TimeStamp=${params.TimeStamp}&HashIV=${INVOICE_HASH_IV}`;
  return crypto.createHash("sha256").update(raw).digest("hex").toUpperCase();
}

// 工具：加密發票內容
function encryptPostData(data: Record<string, any>): string {
  const payload = qs.stringify(data);
  const cipher = crypto.createCipheriv("aes-256-cbc", INVOICE_HASH_KEY, INVOICE_HASH_IV);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]).toString("hex");
}

// 工具：發送 QRCode Email
async function sendEsimEmail(to: string, orderNumber: string, html: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "wandmesim@gmail.com",
      pass: "hwoywmluqvsuluss",
    },
  });

  await transporter.sendMail({
    from: `eSIM 團隊 <wandmesim@gmail.com>`,
    to,
    subject: `訂單 ${orderNumber} 的 eSIM QRCode`,
    html: `<p>您好，以下是您的 eSIM：</p>${html}`,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { transactionId, orderNo } = req.body;
  if (!transactionId || !orderNo) return res.status(400).json({ error: "缺少必要參數" });

  try {
    // 1. 查詢對應 WooCommerce 訂單
    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 20, orderby: "date", order: "desc" },
    });

    const order = orders.find((o: any) =>
      o.meta_data?.some((m: any) => m.key === "linepay_order_no" && m.value === orderNo)
    );
    if (!order) throw new Error("找不到對應 WooCommerce 訂單");

    const orderId = order.id;
    const { data: fullOrder } = await axios.get(`${WOOCOMMERCE_API_URL}/${orderId}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    // 2. 產生 QRCode
    const planIdsWithQty = fullOrder.line_items.flatMap((item: any) => {
      const planId = item.meta_data?.find((m: any) => m.key === "esim_plan_id")?.value;
      return planId ? [{ planId, quantity: item.quantity || 1 }] : [];
    });
    if (planIdsWithQty.length === 0) throw new Error("找不到 esim_plan_id");

    const allHtml: string[] = [];

    for (const { planId, quantity } of planIdsWithQty) {
      const resolvedPlanId = PLAN_ID_MAP[planId] || planId;
      const { data: esim } = await axios.post(ESIM_PROXY_URL, {
        channel_dataplan_id: resolvedPlanId,
        number: quantity,
      });

     const imageList: string[] = Array.isArray(esim.qrcode)
  ? esim.qrcode
  : esim.qrcode
  ? [String(esim.qrcode)]
  : [];

      const imagesHtml = imageList
        .map((img) => `<img src="${img.startsWith("http") ? img : `data:image/png;base64,${img}`}" style="max-width:300px;" />`)
        .join("<br />");
      allHtml.push(imagesHtml);

      await axios.put(`${WOOCOMMERCE_API_URL}/${orderId}`, {
        status: "processing",
        meta_data: [
          { key: "esim_qrcode", value: imageList[0] || "" },
          { key: "esim_topup_id", value: esim.topup_id },
          { key: "esim_plan_id", value: planId },
          { key: "esim_quantity", value: quantity },
        ],
      }, { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } });

      await axios.post(`${WOOCOMMERCE_API_URL}/${orderId}/notes`, {
        note: `<strong>eSIM QRCode (${planId}):</strong><br />${imagesHtml}`,
        customer_note: true,
      }, { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } });
    }

    const customerEmail = order.billing?.email;
    if (customerEmail) await sendEsimEmail(customerEmail, orderNo, allHtml.join("<hr />"));

    // 3. ezPay 發票
    const buyerName = `${order.billing?.first_name || ""}${order.billing?.last_name || ""}` || "網路訂單";
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const amt = Math.round(Number(order.total));
    const itemNames = order.line_items.map((i: any) => i.name).join("|");
    const itemCounts = order.line_items.map((i: any) => i.quantity).join("|");
    const itemPrices = order.line_items.map((i: any) => String(Math.round(Number(i.total) / i.quantity))).join("|");
    const itemAmts = order.line_items.map((i: any) => i.total).join("|");
    const itemUnits = order.line_items.map(() => "項").join("|");

    const invoiceData: Record<string, any> = {
      RespondType: "JSON",
      Version: "1.5",
      TimeStamp: timeStamp,
      MerchantID: INVOICE_MERCHANT_ID,
      MerchantOrderNo: orderNo,
      Status: "1",
      Category: "B2C",
      BuyerName: buyerName,
      BuyerEmail: customerEmail,
      PrintFlag: "Y",
      TaxType: "1",
      TaxRate: 5,
      Amt: amt,
      TaxAmt: 0,
      TotalAmt: amt,
      ItemName: itemNames,
      ItemCount: itemCounts,
      ItemUnit: itemUnits,
      ItemPrice: itemPrices,
      ItemAmt: itemAmts,
      Comment: "感謝您的訂購",
    };

    invoiceData.CheckCode = genCheckCode({
      MerchantID: invoiceData.MerchantID,
      MerchantOrderNo: invoiceData.MerchantOrderNo,
      Amt: String(invoiceData.Amt),
      TimeStamp: invoiceData.TimeStamp,
    });

    const encrypted = encryptPostData(invoiceData);
    const invoiceRes = await axios.post(INVOICE_API_URL, qs.stringify({
      MerchantID_: INVOICE_MERCHANT_ID,
      PostData_: encrypted,
    }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const invoiceJson = JSON.parse(invoiceRes.data.Result);
    await axios.post(`${WOOCOMMERCE_API_URL}/${orderId}/notes`, {
      note: `✅ 發票已開立\n發票號碼：${invoiceJson.InvoiceNumber}\n隨機碼：${invoiceJson.RandomNum}`,
      customer_note: false,
    }, { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } });

    await axios.put(`${WOOCOMMERCE_API_URL}/${orderId}`, {
      meta_data: [
        { key: "invoice_number", value: invoiceJson.InvoiceNumber },
        { key: "invoice_random", value: invoiceJson.RandomNum },
        { key: "invoice_qrcode_l", value: invoiceJson.QRcodeL },
        { key: "invoice_qrcode_r", value: invoiceJson.QRcodeR },
      ],
    }, { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } });

    res.status(200).json({ success: true, message: "LINE Pay 訂單處理完成" });
  } catch (err: any) {
    console.error("❌ LINE Pay callback 發生錯誤：", err.message || err);
    res.status(500).json({ error: "LINE Pay 回調處理失敗", detail: err.message });
  }
}
