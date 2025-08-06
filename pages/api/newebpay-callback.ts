import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";
import qs from "qs";

// 藍新金流金鑰
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

// WooCommerce API
const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

// eSIM Proxy API
const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

// ezPay 發票設定
const INVOICE_API_URL = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV = "PtgsjF33nlm8q2kC";

// SKU 對照表
const PLAN_ID_MAP: Record<string, string> = {
  "Malaysia-Daily500MB-1-A0": "90ab730c-b369-4144-a6f5-be4376494791",
};

function genCheckCode(params: Record<string, string>): string {
  const raw = `HashKey=${INVOICE_HASH_KEY}&Amt=${params.Amt}&MerchantID=${params.MerchantID}&MerchantOrderNo=${params.MerchantOrderNo}&TimeStamp=${params.TimeStamp}&HashIV=${INVOICE_HASH_IV}`;
  return crypto.createHash("sha256").update(raw).digest("hex").toUpperCase();
}

function encryptPostData(data: Record<string, any>): string {
  const payload = qs.stringify(data);
  const cipher = crypto.createCipheriv("aes-256-cbc", INVOICE_HASH_KEY, INVOICE_HASH_IV);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return encrypted.toString("hex");
}

function aesDecrypt(encryptedText: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

async function sendEsimEmail(to: string, orderNumber: string, imagesHtml: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
   user: "wandmesim@gmail.com",
      pass: "hwoywmluqvsuluss",
    },
  });

  await transporter.sendMail({
    from: `eSIM 團隊 <bob112722761236tom@gmail.com>`,
    to,
    subject: `訂單 ${orderNumber} 的 eSIM QRCode`,
    html: `<p>您好，感謝您的購買！以下是您的 eSIM QRCode：</p><p>${imagesHtml}</p>`
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const { TradeInfo } = req.body;
  try {
    const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
    console.log("🔓 解密後 TradeInfo：", decrypted);
    const result = JSON.parse(decrypted).Result;
    const orderNumber = result?.MerchantOrderNo;

    if (!result || result.Status === "FAILED") {
      console.warn("⚠️ 非成功交易：", result);
      res.redirect(302, `/thank-you?status=fail&orderNo=${orderNumber || ""}`);
      return;
    }

    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 20, orderby: "date", order: "desc" },
    });

    const order = orders.find((o: any) => o.meta_data?.some((m: any) => m.key === "newebpay_order_no" && m.value === orderNumber));
    if (!order) {
      console.error("❌ 找不到 WooCommerce 訂單，編號：", orderNumber);
      res.redirect(302, `/thank-you?status=notfound&orderNo=${orderNumber}`);
      return;
    }
    const orderId = order.id;
    const { data: fullOrder } = await axios.get(`${WOOCOMMERCE_API_URL}/${orderId}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    const planIdsWithQty = fullOrder.line_items.flatMap((item: any) => {
      const planId = item.meta_data?.find((m: any) => m.key === "esim_plan_id")?.value;
      return planId ? [{ planId, quantity: item.quantity || 1 }] : [];
    });

    if (planIdsWithQty.length === 0) throw new Error("❌ 無法從訂單抓取 esim_plan_id");

    const allImagesHtml: string[] = [];

    for (const { planId, quantity } of planIdsWithQty) {
      const resolvedPlanId = PLAN_ID_MAP[planId] || planId;
      const { data: esim } = await axios.post(ESIM_PROXY_URL, { channel_dataplan_id: resolvedPlanId, number: quantity });
      const imageList = Array.isArray(esim.qrcode) ? esim.qrcode : [String(esim.qrcode)];
      const imagesHtml = imageList.map((item: string) => {
        const src = item.startsWith("http") ? item : `data:image/png;base64,${item}`;
        return `<img src="${src}" style="max-width:300px;margin-bottom:10px;" />`;
      }).join("<br />");
      allImagesHtml.push(imagesHtml);

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

    const customerEmail: string = order.billing?.email;
    if (customerEmail) await sendEsimEmail(customerEmail, orderNumber, allImagesHtml.join("<br /><hr><br />"));

    // === 發票欄位準備 ===
    const buyerName = `${order.billing?.first_name || ""}${order.billing?.last_name || ""}` || "網路訂單";
    const buyerEmail = order.billing?.email || "test@example.com";
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const amt = Math.round(Number(result.Amt));

    const itemNames = order.line_items.map((item: any) => item.name).join("|");
    const itemCounts = order.line_items.map((item: any) => item.quantity).join("|");
    const itemPrices = order.line_items.map((item: any) => String(Math.round(Number(item.total) / item.quantity))).join("|");
    const itemAmts = order.line_items.map((item: any) => item.total).join("|");
    const itemUnits = order.line_items.map(() => "項").join("|"); // ✅ 修正：每個商品對應一個單位

    try {
      const invoiceData: Record<string, any> = {
  RespondType: "JSON",
  Version: "1.5",
  TimeStamp: timeStamp,
  MerchantID: INVOICE_MERCHANT_ID,
  MerchantOrderNo: result.MerchantOrderNo || "unknown",
  Status: "1",
  Category: "B2C",
  BuyerName: buyerName,
  BuyerEmail: buyerEmail,
  PrintFlag: "N",           // ✅ 改這裡：讓 ezPay 自動寄 email
  CarrierType: "",          // ✅ 空白即可
  CarrierNum: "",
  Donation: "0",
  LoveCode: "",
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
  Notify: "E",              // ✅ 加這行：通知方式 email
};

      invoiceData.CheckCode = genCheckCode({
        MerchantID: invoiceData.MerchantID,
        MerchantOrderNo: invoiceData.MerchantOrderNo,
        Amt: String(invoiceData.Amt),
        TimeStamp: invoiceData.TimeStamp,
      });

      console.log("🧾 發票送出資料：", invoiceData);

      const encryptedPostData = encryptPostData(invoiceData);
      const invoiceRes = await axios.post(INVOICE_API_URL, qs.stringify({
        MerchantID_: INVOICE_MERCHANT_ID,
        PostData_: encryptedPostData,
      }), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      console.log("📄 發票回傳原始資料：", invoiceRes.data);

      if (invoiceRes.data.Status !== "SUCCESS") {
        throw new Error(`發票開立失敗：${invoiceRes.data.Message || "未知錯誤"} (${invoiceRes.data.Status})`);
      }

      const invoiceJson = JSON.parse(invoiceRes.data.Result);

      await axios.post(`${WOOCOMMERCE_API_URL}/${orderId}/notes`, {
        note: `✅ 發票已開立\n發票號碼：${invoiceJson.InvoiceNumber}\n隨機碼：${invoiceJson.RandomNum}\n開立時間：${invoiceJson.CreateTime}`,
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
    } catch (invoiceErr: any) {
      console.error("❌ 發票開立失敗：", invoiceErr?.response?.data || invoiceErr.message);
      await axios.post(`${WOOCOMMERCE_API_URL}/${orderId}/notes`, {
        note: `❌ 發票開立失敗：${invoiceErr?.message}`,
        customer_note: false,
      }, { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } });
    }

    res.redirect(302, `/thank-you?status=success&orderNo=${orderNumber}`);
  } catch (error: any) {
    console.error("❌ Callback 錯誤：", error?.response?.data || error.message);
    res.redirect(302, `/thank-you?status=error`);
  }
}
