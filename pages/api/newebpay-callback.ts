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
/** ===== 發送發票 Email ===== */
async function sendInvoiceEmail(to: string, orderNumber: string, inv: any): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: "wandmesim@gmail.com", pass: "hwoywmluqvsuluss" },
  });

  const qrL = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(inv.QRcodeL)}`;
  const qrR = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(inv.QRcodeR)}`;

  await transporter.sendMail({
    from: `eSIM 團隊 <wandmesim@gmail.com>`,
    to,
    subject: `訂單 ${orderNumber} 發票通知（${inv.InvoiceNumber}）`,
    html: `
      <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.6">
        <p>您好，您本次訂單（${orderNumber}）的電子發票已開立：</p>
        <ul>
          <li><b>發票號碼：</b>${inv.InvoiceNumber}</li>
          <li><b>隨機碼：</b>${inv.RandomNum}</li>
          <li><b>開立時間：</b>${inv.CreateTime}</li>
        </ul>
        <p>手機條碼掃描用 QR Code：</p>
        <div style="display:flex;gap:16px;align-items:center">
          <div><img src="${qrL}" alt="QR L"></div>
          <div><img src="${qrR}" alt="QR R"></div>
        </div>
        <p style="margin-top:12px">若需紙本或異動，請回覆本信與我們聯繫，謝謝！</p>
      </div>
    `,
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

      // 聚合陣列（給 ThankYou / 客服好讀）
      imageList.forEach((raw: string, i: number) => {
        const src = raw.startsWith("http") ? raw : `data:image/png;base64,${raw}`;
        qrcodes.push({ name: `${li.name} #${i + 1}`, src });
      });

      allImagesHtml.push(`<div><strong>${li.name}</strong><br/>${imagesHtml}</div>`);

      // 加註記（買家可見）
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
        meta_data: [
          { key: "esim_qrcodes", value: JSON.stringify(qrcodes) }, // ★ 聚合存法
        ],
      },
      { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
    );

    // 寄信
    const customerEmail: string = order.billing?.email;
    if (customerEmail && qrcodes.length) {
      await sendEsimEmail(customerEmail, orderNumber, allImagesHtml.join("<hr style='margin:16px 0'/>"));
    }

    /** 3) 發票 — 用 cents 計算，支援固定金額/百分比折扣，不再額外加「折價 SAVE」行 */
    const buyerName = `${order.billing?.first_name || ""}${order.billing?.last_name || ""}` || "網路訂單";
    const buyerEmail = order.billing?.email || "test@example.com";
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // (A) 以「未折扣小計 subtotal」作為分配基礎（Woo 會把 percent/fixed_cart 分到 order 層）
    type BasisRow = { name: string; qty: number; subtotalCents: number };
    const basisRows: BasisRow[] = (fullOrder.line_items || []).map((li: any) => ({
      name: li.name,
      qty: li.quantity || 1,
      subtotalCents: toCents(li.subtotal), // 未折扣小計
    }));

    let sumSubtotalCents = basisRows.reduce((s, r) => s + r.subtotalCents, 0);

    // (B) 訂單實付總額（含折扣）— 以金流回傳為準；若無則用 Woo total
    const totalPaidCents = toCents(result.Amt ?? fullOrder.total);

    // 防呆：若 subtotal 全零（例如促銷全免），退回用 line_items.total
    if (sumSubtotalCents === 0) {
      for (const r of basisRows) {
        const li = (fullOrder.line_items || []).find((x: any) => x.name === r.name);
        r.subtotalCents = toCents(li?.total || 0);
      }
      sumSubtotalCents = basisRows.reduce((s, r) => s + r.subtotalCents, 0);
    }

    // (C) 計算「需分配的折扣」（以分）
    let discountTotalCents = Math.max(0, sumSubtotalCents - totalPaidCents);

    // (D) 按比例把折扣分配到各品項，得到「品項實付分」
    const paidRows = basisRows.map((r, idx) => {
      if (sumSubtotalCents === 0) return { ...r, paidCents: 0 };
      const ratio = r.subtotalCents / sumSubtotalCents;
      const allocDiscount = idx === basisRows.length - 1
        ? discountTotalCents // 最後一項吃掉剩餘，避免四捨五入殘差
        : Math.min(discountTotalCents, roundHalfUp(discountTotalCents * ratio));
      discountTotalCents -= allocDiscount;
      const paid = Math.max(0, r.subtotalCents - allocDiscount);
      return { ...r, paidCents: paid };
    });

    // (E) 校正合計（理論上相等；若不等，最後一項補差）
    let sumPaid = paidRows.reduce((s, r) => s + r.paidCents, 0);
    const diff = totalPaidCents - sumPaid;
    if (diff !== 0 && paidRows.length) {
      paidRows[paidRows.length - 1].paidCents = Math.max(0, paidRows[paidRows.length - 1].paidCents + diff);
      sumPaid = paidRows.reduce((s, r) => s + r.paidCents, 0);
    }
// (F) 換算「每個 line item 的整體金額」為整數元，不再按單件拆分
const itemNames: string[] = [];
const itemCounts: string[] = [];
const itemUnits: string[] = [];
const itemPrices: string[] = [];
const itemAmts: string[] = [];

let acc = 0;
paidRows.forEach((r, idx) => {
  // lineCents = 該品項分配後的「整體」實付金額（分）
  let lineCents = r.paidCents;

  // 最後一項補差，確保 sum(item) == totalPaidCents
  if (idx === paidRows.length - 1) {
    const remain = totalPaidCents - (acc + lineCents);
    lineCents += remain;
  }
  acc += lineCents;

  const lineDollars = fromCents(lineCents); // 轉整數元

  // ✅ 發票上用「1」個單位開立，單價 = 小計 = 該品項整體金額
  itemNames.push(`${r.name} x${r.qty}`); // 例如「馬來西亞 eSIM - 1天 500MB/日 x2」
  itemCounts.push("1");
  itemUnits.push("項");
  itemPrices.push(String(lineDollars));
  itemAmts.push(String(lineDollars));
});

    // (G) 稅額（以分計算，再轉元整數）
    const taxRate = 5; // 應稅
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
      Amt: fromCents(amtExclTax_cents),  // 整數元
      TaxAmt: fromCents(taxAmt_cents),   // 整數元
      TotalAmt: fromCents(totalAmt_cents), // 整數元
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

    await axios.post(`${WOOCOMMERCE_API_URL}/${orderId}/notes`, {
  note: `✅ 發票已開立\n發票號碼：${invoiceJson.InvoiceNumber}\n隨機碼：${invoiceJson.RandomNum}\n開立時間：${invoiceJson.CreateTime}`,
  customer_note: false,
}, { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } });

// (2) Woo meta 更新
await axios.put(`${WOOCOMMERCE_API_URL}/${orderId}`, {
  meta_data: [
    { key: "invoice_number", value: invoiceJson.InvoiceNumber },
    { key: "invoice_random", value: invoiceJson.RandomNum },
    { key: "invoice_qrcode_l", value: invoiceJson.QRcodeL },
    { key: "invoice_qrcode_r", value: invoiceJson.QRcodeR },
  ],
}, { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } });

// (3) ✅ 寄發票信（新增這段）
if (customerEmail) {
  try {
    await sendInvoiceEmail(customerEmail, orderNumber, invoiceJson);
    console.log(`📧 Invoice email sent to ${customerEmail} (${invoiceJson.InvoiceNumber})`);
  } catch (mailErr: any) {
    console.error("❌ 發票信寄送失敗：", mailErr?.response || mailErr?.message || mailErr);
  }
}


    res.redirect(302, `/thank-you?status=success&orderNo=${orderNumber}`);
  } catch (error: any) {
    console.error("❌ Callback 錯誤：", error?.response?.data || error.message);
    res.redirect(302, `/thank-you?status=error`);
  }
}
