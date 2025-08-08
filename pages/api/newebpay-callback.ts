import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";
import qs from "qs";

const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

const INVOICE_API_URL = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV = "PtgsjF33nlm8q2kC";

function genCheckCode(params: Record<string, string>): string {
  const raw = `HashKey=${INVOICE_HASH_KEY}&Amt=${params.Amt}&MerchantID=${params.MerchantID}&MerchantOrderNo=${params.MerchantOrderNo}&TimeStamp=${params.TimeStamp}&HashIV=${INVOICE_HASH_IV}`;
  return crypto.createHash("sha256").update(raw).digest("hex").toUpperCase();
}

function encryptPostData(data: Record<string, any>): string {
  const payload = qs.stringify(data);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(INVOICE_HASH_KEY, "utf8"),
    Buffer.from(INVOICE_HASH_IV, "utf8")
  );
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

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const { TradeInfo } = req.body;
  try {
    const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
    console.log("🔓 解密後 TradeInfo：", decrypted);

    const parsed = qs.parse(decrypted);
    const resultStr = parsed.Result as string;
    const result = typeof resultStr === "string" ? qs.parse(resultStr) : resultStr;

    const orderNumber: string = String(result?.MerchantOrderNo || "");
    if (!orderNumber) throw new Error("❌ 缺少 transactionId / MerchantOrderNo");
    if (!result || result.Status === "FAILED") {
      res.redirect(302, `/thank-you?status=fail&orderNo=${orderNumber}`);
      return;
    }

    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 20, orderby: "date", order: "desc" },
    });

    const order = orders.find((o: any) => o.meta_data?.some((m: any) => m.key === "newebpay_order_no" && m.value === orderNumber));
    if (!order) {
      res.redirect(302, `/thank-you?status=notfound&orderNo=${orderNumber}`);
      return;
    }

    const orderId = order.id;
    const { data: fullOrder } = await axios.get(`${WOOCOMMERCE_API_URL}/${orderId}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    const itemNames = [];
    const itemCounts = [];
    const itemUnits = [];
    const itemPrices = [];
    const itemAmts = [];

    for (const item of fullOrder.line_items) {
      itemNames.push(item.name);
      itemCounts.push(String(item.quantity));
      itemUnits.push("項");
      const price = Math.round(Number(item.total) / item.quantity);
      itemPrices.push(String(price));
      itemAmts.push(String(item.total));
    }

    const discount = Number(fullOrder.discount_total || 0);
    if (discount > 0) {
      itemNames.push("折價 SAVE");
      itemCounts.push("1");
      itemUnits.push("次");
      itemPrices.push(`-${discount}`);
      itemAmts.push(`-${discount}`);
    }

    const buyerName = `${fullOrder.billing?.first_name || ""}${fullOrder.billing?.last_name || ""}` || "網路訂單";
    const buyerEmail = fullOrder.billing?.email || "test@example.com";
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const amt = Math.round(Number(result.Amt));

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
      PrintFlag: "Y",
      CarrierType: "",
      CarrierNum: "",
      Donation: "0",
      LoveCode: "",
      TaxType: "1",
      TaxRate: 5,
      Amt: amt,
      TaxAmt: 0,
      TotalAmt: amt,
      ItemName: itemNames.join("|"),
      ItemCount: itemCounts.join("|"),
      ItemUnit: itemUnits.join("|"),
      ItemPrice: itemPrices.join("|"),
      ItemAmt: itemAmts.join("|"),
      Comment: "感謝您的訂購",
    };

    invoiceData.CheckCode = genCheckCode({
      MerchantID: invoiceData.MerchantID,
      MerchantOrderNo: invoiceData.MerchantOrderNo,
      Amt: String(invoiceData.Amt),
      TimeStamp: invoiceData.TimeStamp,
    });

    const encryptedPostData = encryptPostData(invoiceData);
    const invoiceRes = await axios.post(INVOICE_API_URL, qs.stringify({
      MerchantID_: INVOICE_MERCHANT_ID,
      PostData_: encryptedPostData,
    }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (invoiceRes.headers["content-type"].includes("text/html")) {
      console.error("❌ ezPay 發票 API 回傳 HTML 頁面，代表資料錯誤");
      console.error(invoiceRes.data);
      throw new Error("ezPay 回傳 HTML，資料可能加密錯誤或格式有誤");
    }

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

    res.redirect(302, `/thank-you?status=success&orderNo=${orderNumber}`);
  } catch (error: any) {
    console.error("❌ Callback 錯誤：", error?.response?.data || error.message);
    res.redirect(302, `/thank-you?status=error`);
  }
}
