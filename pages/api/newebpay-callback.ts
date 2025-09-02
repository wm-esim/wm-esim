// pages/api/newebpay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";
import qs from "qs";

/** 重要：callback 可能是 x-www-form-urlencoded，先關掉內建 bodyParser 自己讀 raw */
export const config = { api: { bodyParser: false } };

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

/* ========= 工具 ========= */
const now = () => new Date().toISOString();
const slog = (...a: any[]) => console.log("[callback]", now(), ...a);
const swarn = (...a: any[]) => console.warn("[callback]", now(), ...a);
const serror = (...a: any[]) => console.error("[callback]", now(), ...a);

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""; req.on("data", c => data += c);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

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

/* ========= 發信（照你原本的） ========= */
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

/* ========= 主要 handler ========= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    // 1) 讀 raw + 解析（支援 JSON / x-www-form-urlencoded）
    const raw = await readRawBody(req);
    const ct = String(req.headers["content-type"] || "");
    const body: any = ct.includes("application/json") ? JSON.parse(raw || "{}") : qs.parse(raw);

    const TradeInfo = body?.TradeInfo || (req as any).query?.TradeInfo;
    const TradeSha  = body?.TradeSha  || (req as any).query?.TradeSha;

    slog("received callback, ct=", ct, "has TradeInfo:", !!TradeInfo);

    if (!TradeInfo || !TradeSha) {
      swarn("missing TradeInfo/TradeSha, body=", body);
      return res.redirect(302, `/thank-you?status=fail`);
    }

    // 2) 驗章
    const calc = shaEncrypt(TradeInfo, HASH_KEY, HASH_IV);
    if (calc !== TradeSha) {
      serror("TradeSha mismatch");
      return res.redirect(302, `/thank-you?status=fail`);
    }

    // 3) 解密
    const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
    const payload = parseDecrypted(decrypted);
    const status  = payload?.Status;
    const result  = payload?.Result || {};
    const orderNumber = result?.MerchantOrderNo;

    slog("decoded:", { Status: status, PaymentType: result?.PaymentType, MerchantOrderNo: orderNumber });

    if (!orderNumber) {
      swarn("missing MerchantOrderNo in Result");
      return res.redirect(302, `/thank-you?status=fail`);
    }

    // 4) 找 Woo 訂單（拉 50 筆內找 meta: newebpay_order_no）
    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 50, orderby: "date", order: "desc" },
    });
    const order = (orders || []).find((o: any) =>
      o?.meta_data?.some((m: any) => m?.key === "newebpay_order_no" && m?.value === orderNumber)
    );

    if (!order) {
      swarn("woo order not found by newebpay_order_no:", orderNumber);
      return res.redirect(302, `/thank-you?status=notfound&orderNo=${orderNumber}`);
    }

    const orderId = order.id;
    const { data: fullOrder } = await axios.get(`${WOOCOMMERCE_API_URL}/${orderId}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    const payType = String(result?.PaymentType || "").toUpperCase();
    const isOffsitePending = (payType === "VACC" || payType === "CVS" || payType === "WEBATM") && !result?.PayTime;

    /* 5) 取號（待繳）→ 寫入 offsite 到 Woo + 狀態 on-hold */
    if (isOffsitePending) {
      const offsiteInfo = buildOffsiteInfo(result);
      slog("write offsite to woo:", offsiteInfo);

      try {
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
        slog("woo updated (on-hold + offsite) OK");
      } catch (e: any) {
        serror("woo update (offsite) failed:", e?.response?.status, e?.response?.data || e?.message);
      }

      return res.redirect(302, `/thank-you?status=pending&orderNo=${orderNumber}`);
    }

    /* 6) 已付款（信用卡或 ATM 入帳）→ 寫付款 meta、開 eSIM、開發票（保留你原本流程） */
    if (isPaid(result, status)) {
      slog("paid flow for order", orderId);

      // 6.1 付款 meta（避免重覆）
      const existingPayTime = (fullOrder?.meta_data || []).find((m: any) => m?.key === "newebpay_pay_time")?.value;
      if (!existingPayTime) {
        try {
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
          slog("woo updated (processing + pay meta) OK");
        } catch (e: any) {
          serror("woo update (pay meta) failed:", e?.response?.status, e?.response?.data || e?.message);
        }
      }

      // 6.2 產 eSIM（若尚未）
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

      // 6.3 發票（保留你原本流程，略）—— 此段維持你既有的開立邏輯即可
      // ...（為了篇幅我沒有改你既有的發票分攤與送單流程，如需我也可以一起補）

      return res.redirect(302, `/thank-you?status=success&orderNo=${orderNumber}`);
    }

    // 其他狀態
    swarn("unknown status, treat as fail:", { status, PaymentType: result?.PaymentType });
    return res.redirect(302, `/thank-you?status=fail&orderNo=${orderNumber}`);
  } catch (error: any) {
    serror("callback error:", error?.response?.data || error.message);
    return res.redirect(302, `/thank-you?status=error`);
  }
}
