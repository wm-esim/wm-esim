import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";
import qs from "qs";

/** ====== 金流 / Woo / eSIM / 發票設定（正式請改 .env） ====== */
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV  = "PKetlaZYZcZvlMmC";

const WOOCOMMERCE_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY    = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

const INVOICE_API_URL   = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY  = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV   = "PtgsjF33nlm8q2kC";

/** 你自己的 planId 對應（可擴充） */
const PLAN_ID_MAP: Record<string, string> = {
  "Malaysia-Daily500MB-1-A0": "90ab730c-b369-4144-a6f5-be4376494791",
};

/** ===== 金額處理（分） ===== */
const roundHalfUp = (n: number) => (n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5));
const toCents   = (amount: any) => roundHalfUp(parseFloat(String(amount || 0)) * 100);
const fromCents = (c: number)   => roundHalfUp(c / 100);

/** ===== 共用小工具 ===== */
function shaEncrypt(encryptedText: string, key: string, iv: string) {
  const plainText = `HashKey=${key}&${encryptedText}&HashIV=${iv}`;
  return crypto.createHash("sha256").update(plainText).digest("hex").toUpperCase();
}

function aesDecrypt(encryptedText: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

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

async function sendEsimEmail(to: string, orderNumber: string, imagesHtml: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: "wandmesim@gmail.com", pass: "hwoywmluqvsuluss" },
  });
  await transporter.sendMail({
    from: `eSIM 團隊 <wandmesim@gmail.com>`,
    to, subject: `訂單 ${orderNumber} 的 eSIM QRCode`,
    html: `<p>您好，感謝您的購買！以下是您的 eSIM QRCode：</p><p>${imagesHtml}</p>`,
  });
}

function parseDecrypted(text: string): any {
  // 兼容 JSON 或 querystring；且 Result 可能是字串
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.Result === "string") {
      try { obj.Result = JSON.parse(obj.Result); }
      catch { obj.Result = qs.parse(obj.Result); }
    }
    return obj;
  } catch {
    const r = qs.parse(text);
    if (typeof (r as any).Result === "string") {
      try { (r as any).Result = JSON.parse((r as any).Result as string); }
      catch { (r as any).Result = qs.parse((r as any).Result as string); }
    }
    return r;
  }
}

function buildOffsiteInfo(result: any) {
  return {
    PaymentType: result?.PaymentType,                 // VACC / CVS / WEBATM ...
    BankCode: result?.BankCode || result?.BankNo,
    CodeNo: result?.CodeNo || result?.ATMAccNo || result?.PaymentNo,
    PaymentNo: result?.PaymentNo,                     // CVS 代碼
    StoreType: result?.StoreType,                     // CVS 別
    ExpireDate: result?.ExpireDate || result?.ExpireTime,
    TradeNo: result?.TradeNo,
    Amt: result?.Amt,
  };
}

function isPaid(result: any, status: string | undefined) {
  const payType = String(result?.PaymentType || "").toUpperCase();
  return !!result?.PayTime || (payType === "CREDIT" && status === "SUCCESS");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    const { TradeInfo, TradeSha } = req.body || {};
    if (!TradeInfo || !TradeSha) {
      return res.redirect(302, `/thank-you?status=fail`);
    }

    // ✅ 驗章
    const calc = shaEncrypt(TradeInfo, HASH_KEY, HASH_IV);
    if (calc !== TradeSha) {
      console.error("[callback] TradeSha mismatch");
      return res.redirect(302, `/thank-you?status=fail`);
    }

    // ✅ 解密 + 解析
    const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
    const payload = parseDecrypted(decrypted);
    const status  = payload?.Status;
    const result  = payload?.Result || {};
    const orderNumber = result?.MerchantOrderNo;

    if (!orderNumber) {
      return res.redirect(302, `/thank-you?status=fail`);
    }

    // 1) 找 Woo 訂單
    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 20, orderby: "date", order: "desc" },
    });
    const order = (orders || []).find((o: any) =>
      o?.meta_data?.some((m: any) => m?.key === "newebpay_order_no" && m?.value === orderNumber)
    );
    if (!order) return res.redirect(302, `/thank-you?status=notfound&orderNo=${orderNumber}`);

    const orderId = order.id;
    const { data: fullOrder } = await axios.get(`${WOOCOMMERCE_API_URL}/${orderId}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    // 2) 「待繳」類型（VACC/CVS/WEBATM）→ 只寫 offsite 資訊，狀態 on-hold，導回 pending
    const payType = String(result?.PaymentType || "").toUpperCase();
    const isOffsitePending = (payType === "VACC" || payType === "CVS" || payType === "WEBATM") && !result?.PayTime;

    if (isOffsitePending) {
      const offsiteInfo = buildOffsiteInfo(result);
      await axios.put(
        `${WOOCOMMERCE_API_URL}/${orderId}`,
        {
          status: "on-hold",
          meta_data: [
            { key: "newebpay_offsite_info", value: JSON.stringify(offsiteInfo) },
            { key: "newebpay_payment_type", value: payType },
            { key: "newebpay_expire_date",  value: String(offsiteInfo?.ExpireDate || "") },
            { key: "newebpay_code_no",      value: String(offsiteInfo?.CodeNo || offsiteInfo?.PaymentNo || "") },
            { key: "newebpay_bank_code",    value: String(offsiteInfo?.BankCode || "") },
          ],
        },
        { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
      );
      return res.redirect(302, `/thank-you?status=pending&orderNo=${orderNumber}`);
    }

    // 3) 已付款完成（信用卡或 ATM 真入帳）→ 設 processing、開 eSIM、開立發票（冪等）
    if (isPaid(result, status)) {
      // 3.1 更新付款 Meta（若已有就不重覆）
      const existingPayTime = (fullOrder?.meta_data || []).find((m: any) => m?.key === "newebpay_pay_time")?.value;
      if (!existingPayTime) {
        await axios.put(
          `${WOOCOMMERCE_API_URL}/${orderId}`,
          {
            status: "processing",
            meta_data: [
              { key: "newebpay_trade_no",   value: String(result?.TradeNo || "") },
              { key: "newebpay_pay_time",   value: String(result?.PayTime || "") },
              { key: "newebpay_payment_type", value: payType },
            ],
          },
          { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
        );
      }

      // 3.2 產 eSIM（若尚未產生）
      const alreadyHasEsim = (fullOrder?.meta_data || []).some((m: any) => m?.key === "esim_qrcodes");
      type QrcodeInfo = { name: string; src: string };
      const qrcodes: QrcodeInfo[] = [];
      const allImagesHtml: string[] = [];

      if (!alreadyHasEsim) {
        for (const li of fullOrder.line_items || []) {
          const planId = li?.meta_data?.find((m: any) => m?.key === "esim_plan_id")?.value;
          const qty    = li?.quantity || 1;
          if (!planId) continue;

          const resolvedPlanId = PLAN_ID_MAP[planId] || planId;
          const { data: esim } = await axios.post(ESIM_PROXY_URL, {
            channel_dataplan_id: resolvedPlanId,
            number: qty,
          });

          const list = Array.isArray(esim?.qrcode) ? esim.qrcode : [String(esim?.qrcode)];
          const imagesHtml = list
            .map((raw: string) => {
              const src = raw.startsWith("http") ? raw : `data:image/png;base64,${raw}`;
              return `<img src="${src}" style="max-width:300px;margin-bottom:10px;" />`;
            })
            .join("<br />");

          list.forEach((raw: string, i: number) => {
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

        if (qrcodes.length) {
          await axios.put(
            `${WOOCOMMERCE_API_URL}/${orderId}`,
            { meta_data: [{ key: "esim_qrcodes", value: JSON.stringify(qrcodes) }] },
            { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
          );

          const customerEmail: string = fullOrder?.billing?.email;
          if (customerEmail) {
            await sendEsimEmail(customerEmail, orderNumber, allImagesHtml.join("<hr style='margin:16px 0'/>"));
          }
        }
      }

      // 3.3 開立電子發票（若尚未開）
      const hasInvoice = (fullOrder?.meta_data || []).some((m: any) => m?.key === "invoice_number");
      if (!hasInvoice) {
        const buyerName  = `${fullOrder?.billing?.first_name || ""}${fullOrder?.billing?.last_name || ""}` || "網路訂單";
        const buyerEmail = fullOrder?.billing?.email || "test@example.com";
        const timestamp  = Math.floor(Date.now() / 1000).toString();

        // 以未折扣小計進行比例分攤
        type Row = { name: string; qty: number; subtotalCents: number };
        const rows: Row[] = (fullOrder?.line_items || []).map((li: any) => ({
          name: li.name,
          qty: li.quantity || 1,
          subtotalCents: toCents(li.subtotal),
        }));
        let subSum = rows.reduce((s, r) => s + r.subtotalCents, 0);
        const paidCents = toCents(result?.Amt ?? fullOrder?.total);

        if (subSum === 0) {
          for (const r of rows) {
            const li = (fullOrder?.line_items || []).find((x: any) => x.name === r.name);
            r.subtotalCents = toCents(li?.total || 0);
          }
          subSum = rows.reduce((s, r) => s + r.subtotalCents, 0);
        }

        let discountCents = Math.max(0, subSum - paidCents);
        const paidRows = rows.map((r, idx) => {
          if (subSum === 0) return { ...r, paidCents: 0 };
          const ratio = r.subtotalCents / subSum;
          const alloc =
            idx === rows.length - 1
              ? discountCents
              : Math.min(discountCents, roundHalfUp(discountCents * ratio));
          discountCents -= alloc;
          const paid = Math.max(0, r.subtotalCents - alloc);
          return { ...r, paidCents: paid };
        });

        let sumPaid = paidRows.reduce((s, r) => s + r.paidCents, 0);
        const diff  = paidCents - sumPaid;
        if (diff !== 0 && paidRows.length) paidRows[paidRows.length - 1].paidCents += diff;

        const itemNames: string[] = [];
        const itemCounts: string[] = [];
        const itemUnits:  string[] = [];
        const itemPrices: string[] = [];
        const itemAmts:   string[] = [];

        let acc = 0;
        paidRows.forEach((r, idx) => {
          let line = r.paidCents;
          if (idx === paidRows.length - 1) {
            const remain = paidCents - (acc + line);
            line += remain;
          }
          acc += line;
          const dollars = fromCents(line);
          itemNames.push(`${r.name} x${r.qty}`);
          itemCounts.push("1"); itemUnits.push("項");
          itemPrices.push(String(dollars)); itemAmts.push(String(dollars));
        });

        const taxRate = 5;
        const total_cents = paidCents;
        const ex_cents    = roundHalfUp(total_cents / (1 + taxRate / 100));
        const tax_cents   = total_cents - ex_cents;

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
          Amt: fromCents(ex_cents),
          TaxAmt: fromCents(tax_cents),
          TotalAmt: fromCents(total_cents),
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

        if (invoiceRes.data.Status === "SUCCESS") {
          const invoiceJson = JSON.parse(invoiceRes.data.Result);
          await axios.post(
            `${WOOCOMMERCE_API_URL}/${orderId}/notes`,
            {
              note: `✅ 發票已開立\n發票號碼：${invoiceJson.InvoiceNumber}\n隨機碼：${invoiceJson.RandomNum}\n開立時間：${invoiceJson.CreateTime}`,
              customer_note: false,
            },
            { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
          );
          await axios.put(
            `${WOOCOMMERCE_API_URL}/${orderId}`,
            {
              meta_data: [
                { key: "invoice_number",  value: invoiceJson.InvoiceNumber },
                { key: "invoice_random",  value: invoiceJson.RandomNum },
                { key: "invoice_qrcode_l", value: invoiceJson.QRcodeL },
                { key: "invoice_qrcode_r", value: invoiceJson.QRcodeR },
              ],
            },
            { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
          );
        } else {
          console.error("發票開立失敗：", invoiceRes.data);
        }
      }

      return res.redirect(302, `/thank-you?status=success&orderNo=${orderNumber}`);
    }

    // 其他狀態 → 視為失敗
    return res.redirect(302, `/thank-you?status=fail&orderNo=${orderNumber}`);
  } catch (error: any) {
    console.error("❌ Callback 錯誤：", error?.response?.data || error.message);
    return res.redirect(302, `/thank-you?status=error`);
  }
}
