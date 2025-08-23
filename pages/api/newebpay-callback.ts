import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";
import qs from "qs";

const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

const INVOICE_API_URL = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV = "PtgsjF33nlm8q2kC";

const PLAN_ID_MAP: Record<string, string> = {
  "Malaysia-Daily500MB-1-A0": "90ab730c-b369-4144-a6f5-be4376494791",
};

/** ===== 工具：金額處理（分） ===== */
const roundHalfUp = (n: number) => (n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5));
const toCents = (amount: any) => roundHalfUp(parseFloat(String(amount || 0)) * 100);
const fromCents = (c: number) => roundHalfUp(c / 100); // 回整數元（ezPay 要整數）

function genCheckCode(params: Record<string, string>): string {
  const raw = `HashKey=${INVOICE_HASH_KEY}&Amt=${params.Amt}&MerchantID=${params.MerchantID}&MerchantOrderNo=${params.MerchantOrderNo}&TimeStamp=${params.TimeStamp}&HashIV=${INVOICE_HASH_IV}`;
  return crypto.createHash("sha256").update(raw).digest("hex").toUpperCase();
}

function encryptAES(data: any, key: string, iv: string) {
  const text = qs.stringify(data);
  const cipher = crypto.createCipheriv("aes-256-cbc", key.padEnd(32, " "), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

function aesDecrypt(encryptedText: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** ===== eSIM 寄信（保留） ===== */
async function sendEsimEmail(to: string, orderNumber: string, imagesHtml: string): Promise<void> {
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
    html: `<p>您好，感謝您的購買！以下是您的 eSIM QRCode：</p><p>${imagesHtml}</p>`,
  });
}

/* ======================= 主流程 ======================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const { TradeInfo } = req.body;

  try {
    const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);

    let parsed: any;
    try {
      parsed = JSON.parse(decrypted);
    } catch {
      parsed = qs.parse(decrypted);
      if (typeof parsed.Result === "string") parsed.Result = JSON.parse(parsed.Result);
    }

    if (parsed.Status !== "SUCCESS") {
      res.redirect(302, `/thank-you?status=fail&orderNo=${parsed?.Result?.MerchantOrderNo || ""}`);
      return;
    }

    const result = parsed.Result;
    const orderNumber = result.MerchantOrderNo;

    // 1) 找 Woo 訂單
    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 20, orderby: "date", order: "desc" },
    });

    const order = orders.find((o: any) =>
      o.meta_data?.some((m: any) => m.key === "newebpay_order_no" && m.value === orderNumber)
    );

    if (!order) {
      res.redirect(302, `/thank-you?status=notfound&orderNo=${orderNumber}`);
      return;
    }

    const orderId = order.id;
    const { data: fullOrder } = await axios.get(`${WOOCOMMERCE_API_URL}/${orderId}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    /** 2) 產 eSIM（每個 line_item 有 esim_plan_id 的才產） */
    type QrcodeInfo = { name: string; src: string };
    const qrcodes: QrcodeInfo[] = [];
    const allImagesHtml: string[] = [];

    for (const li of fullOrder.line_items) {
      const planId = li.meta_data?.find((m: any) => m.key === "esim_plan_id")?.value;
      const qty = li.quantity || 1;
      if (!planId) continue;

      const resolvedPlanId = PLAN_ID_MAP[planId] || planId;
      const { data: esim } = await axios.post(ESIM_PROXY_URL, { channel_dataplan_id: resolvedPlanId, number: qty });

      const imageList = Array.isArray(esim.qrcode) ? esim.qrcode : [String(esim.qrcode)];
      const imagesHtml = imageList
        .map((item: string) => {
          const src = item.startsWith("http") ? item : `data:image/png;base64,${item}`;
          return `<img src="${src}" style="max-width:300px;margin-bottom:10px;" />`;
        })
        .join("<br />");

      imageList.forEach((raw: string, i: number) => {
        const src = raw.startsWith("http") ? raw : `data:image/png;base64,${raw}`;
        qrcodes.push({ name: `${li.name} #${i + 1}`, src });
      });

      allImagesHtml.push(`<div><strong>${li.name}</strong><br/>${imagesHtml}</div>`);

      await axios.post(
        `${WOOCOMMERCE_API_URL}/${orderId}/notes`,
        { note: `<strong>eSIM QRCode (${li.name}):</strong><br />${imagesHtml}`, customer_note: true },
        { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
      );
    }

    // 一次性更新訂單狀態 & 存聚合 QR 陣列
    await axios.put(
      `${WOOCOMMERCE_API_URL}/${orderId}`,
      {
        status: "processing",
        meta_data: [{ key: "esim_qrcodes", value: JSON.stringify(qrcodes) }],
      },
      { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
    );

    // 寄 eSIM 信（保留）
    const customerEmail: string = order.billing?.email;
    if (customerEmail && qrcodes.length) {
      await sendEsimEmail(customerEmail, orderNumber, allImagesHtml.join("<hr style='margin:16px 0'/>"));
    }

    /** 3) 發票：開立 + 寫 Woo（移除寄發票信） */
    const buyerName = `${order.billing?.first_name || ""}${order.billing?.last_name || ""}` || "網路訂單";
    const buyerEmail = order.billing?.email || "test@example.com";
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // (A) 以未折扣小計分配
    type BasisRow = { name: string; qty: number; subtotalCents: number };
    const basisRows: BasisRow[] = (fullOrder.line_items || []).map((li: any) => ({
      name: li.name,
      qty: li.quantity || 1,
      subtotalCents: toCents(li.subtotal),
    }));
    let sumSubtotalCents = basisRows.reduce((s, r) => s + r.subtotalCents, 0);

    // (B) 實付
    const totalPaidCents = toCents(result.Amt ?? fullOrder.total);

    if (sumSubtotalCents === 0) {
      for (const r of basisRows) {
        const li = (fullOrder.line_items || []).find((x: any) => x.name === r.name);
        r.subtotalCents = toCents(li?.total || 0);
      }
      sumSubtotalCents = basisRows.reduce((s, r) => s + r.subtotalCents, 0);
    }

    // (C) 折扣
    let discountTotalCents = Math.max(0, sumSubtotalCents - totalPaidCents);

    // (D) 分配
    const paidRows = basisRows.map((r, idx) => {
      if (sumSubtotalCents === 0) return { ...r, paidCents: 0 };
      const ratio = r.subtotalCents / sumSubtotalCents;
      const allocDiscount =
        idx === basisRows.length - 1
          ? discountTotalCents
          : Math.min(discountTotalCents, roundHalfUp(discountTotalCents * ratio));
      discountTotalCents -= allocDiscount;
      const paid = Math.max(0, r.subtotalCents - allocDiscount);
      return { ...r, paidCents: paid };
    });

    // (E) 校正
    let sumPaid = paidRows.reduce((s, r) => s + r.paidCents, 0);
    const diff = totalPaidCents - sumPaid;
    if (diff !== 0 && paidRows.length) {
      paidRows[paidRows.length - 1].paidCents = Math.max(0, paidRows[paidRows.length - 1].paidCents + diff);
      sumPaid = paidRows.reduce((s, r) => s + r.paidCents, 0);
    }

    // (F) 發票品項（整品項為 1 單位）
    const itemNames: string[] = [];
    const itemCounts: string[] = [];
    const itemUnits: string[] = [];
    const itemPrices: string[] = [];
    const itemAmts: string[] = [];

    let acc = 0;
    paidRows.forEach((r, idx) => {
      let lineCents = r.paidCents;
      if (idx === paidRows.length - 1) {
        const remain = totalPaidCents - (acc + lineCents);
        lineCents += remain;
      }
      acc += lineCents;
      const lineDollars = fromCents(lineCents);
      itemNames.push(`${r.name} x${r.qty}`);
      itemCounts.push("1");
      itemUnits.push("項");
      itemPrices.push(String(lineDollars));
      itemAmts.push(String(lineDollars));
    });

    // (G) 稅額
    const taxRate = 5;
    const totalAmt_cents = totalPaidCents;
    const amtExclTax_cents = roundHalfUp(totalAmt_cents / (1 + taxRate / 100));
    const taxAmt_cents = totalAmt_cents - amtExclTax_cents;

    const invoiceData: Record<string, any> = {
      RespondType: "JSON",
      Version: "1.4",
      TimeStamp: timestamp,
      MerchantOrderNo: `INV${timestamp}`,
      MerchantID: INVOICE_MERCHANT_ID,
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
      TaxRate: taxRate,
      Amt: fromCents(amtExclTax_cents),
      TaxAmt: fromCents(taxAmt_cents),
      TotalAmt: fromCents(totalAmt_cents),
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

    const encrypted = encryptAES(invoiceData, INVOICE_HASH_KEY, INVOICE_HASH_IV);
    const invoiceRes = await axios.post(
      INVOICE_API_URL,
      qs.stringify({ MerchantID_: INVOICE_MERCHANT_ID, PostData_: encrypted }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (invoiceRes.data.Status !== "SUCCESS") {
      throw new Error(`發票開立失敗：${invoiceRes.data.Message || "未知錯誤"} (${invoiceRes.data.Status})`);
    }

    const invoiceJson = JSON.parse(invoiceRes.data.Result);

    // (1) Woo 訂單留言
    await axios.post(
      `${WOOCOMMERCE_API_URL}/${orderId}/notes`,
      {
        note: `✅ 發票已開立\n發票號碼：${invoiceJson.InvoiceNumber}\n隨機碼：${invoiceJson.RandomNum}\n開立時間：${invoiceJson.CreateTime}`,
        customer_note: false,
      },
      { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
    );

    // (2) Woo Meta
    await axios.put(
      `${WOOCOMMERCE_API_URL}/${orderId}`,
      {
        meta_data: [
          { key: "invoice_number", value: invoiceJson.InvoiceNumber },
          { key: "invoice_random", value: invoiceJson.RandomNum },
          { key: "invoice_qrcode_l", value: invoiceJson.QRcodeL },
          { key: "invoice_qrcode_r", value: invoiceJson.QRcodeR },
        ],
      },
      { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
    );

    // (3) ✅ 寄發票信：已移除（改由原廠寄信）
    // --- nothing here ---

    res.redirect(302, `/thank-you?status=success&orderNo=${orderNumber}`);
  } catch (error: any) {
    console.error("❌ Callback 錯誤：", error?.response?.data || error.message);
    res.redirect(302, `/thank-you?status=error`);
  }
}
