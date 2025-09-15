// /pages/api/newebpay-notify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";
import nodemailer from "nodemailer";

/** 讓 Newebpay 能送 raw body（必須） */
export const config = { api: { bodyParser: false } };
const NOTIFY_VERSION = "v5.2.1";

/** ===== 建議改用 .env（此處沿用你現值） ===== */
const MERCHANT_ID = "MS3788816305";
const HASH_KEY    = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV     = "PKetlaZYZcZvlMmC";

const WC_API_BASE = "https://fegoesim.com/wp-json/wc/v3";
const WC_CK = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_CS = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

/** ===== eSIM / 發票設定（與 callback 同步） ===== */
const ESIM_PROXY_URL = "https://www.wmesim.com/api/esim/qrcode";

const INVOICE_API_URL     = "https://inv.ezpay.com.tw/Api/invoice_issue";
const INVOICE_MERCHANT_ID = "345049107";
const INVOICE_HASH_KEY    = "FnDByoo3m9U4nVi29UciIbAHVQRQogHG";
const INVOICE_HASH_IV     = "PtgsjF33nlm8q2kC";

/** 你自己的 planId 對應（可擴充） */
const PLAN_ID_MAP: Record<string, string> = {
  "Malaysia-Daily500MB-1-A0": "90ab730c-b369-4144-a6f5-be4376494791",
};

/* ------------------------- Debug 控制 ------------------------- */
const ENV_DEBUG_ON  = String(process.env.NEWEBPAY_DEBUG || "") === "1";
const ENV_ECHO_HDR  = String(process.env.NEWEBPAY_ECHO_HEADERS || "") === "1";
const ENV_ECHO_BODY = String(process.env.NEWEBPAY_ECHO_BODY || "") === "1";
const isOn = (v?: string | string[]) => String(Array.isArray(v) ? v[0] : v || "").trim() === "1";

/* ------------------------- helpers ------------------------- */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function sha(encrypted: string, key: string, iv: string) {
  const s = `HashKey=${key}&${encrypted}&HashIV=${iv}`;
  return crypto.createHash("sha256").update(s).digest("hex").toUpperCase();
}
/** 嘗試 hex → base64 → 反之；都失敗則 throw */
function aesDecryptSafe(input: string, key: string, iv: string): string {
  const ti = String(input || "").trim();
  const tryDec = (enc: "hex" | "base64") => {
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    decipher.setAutoPadding(true);
    let out = decipher.update(ti, enc, "utf8");
    out += decipher.final("utf8");
    return out;
  };
  if (/^[0-9a-fA-F]+$/.test(ti)) { try { return tryDec("hex"); } catch { return tryDec("base64"); } }
  else                           { try { return tryDec("base64"); } catch { return tryDec("hex"); } }
}
function parseDecrypted(text: string): any {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.Result === "string") {
      try { obj.Result = JSON.parse(obj.Result); }
      catch { obj.Result = qs.parse(obj.Result); }
    }
    return obj;
  } catch {
    const r = qs.parse(text);
    if ((r as any).Result && typeof (r as any).Result === "string") {
      try { (r as any).Result = JSON.parse((r as any).Result as string); }
      catch { (r as any).Result = qs.parse((r as any).Result as string); }
    }
    return r;
  }
}
function hasPayMoment(result: any) {
  return !!(result?.PayTime || result?.PaymentTime || result?.PayDate || result?.CloseTime);
}
function firstPayMoment(result: any) {
  return result?.PayTime || result?.PaymentTime || result?.PayDate || result?.CloseTime || "";
}
function isPaid(result: any, status?: string) {
  const t = String(result?.PaymentType || "").toUpperCase();
  const paid = hasPayMoment(result);
  if (t === "CREDIT") return status === "SUCCESS";
  return paid;
}
function isOffsitePending(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  return (t === "VACC" || t === "CVS" || t === "WEBATM") && !hasPayMoment(result);
}
function buildOffsiteInfo(result: any) {
  return {
    PaymentType: String(result?.PaymentType || "").toUpperCase(),
    BankCode:    result?.BankCode || result?.BankNo || result?.PayBankCode || "",
    CodeNo:      result?.CodeNo || result?.ATMAccNo || result?.PaymentNo || result?.PayerAccount5Code || "",
    PaymentNo:   result?.PaymentNo || "",
    StoreType:   result?.StoreType || "",
    ExpireDate:  result?.ExpireDate || result?.ExpireTime || "",
    TradeNo:     result?.TradeNo || "",
    Amt:         result?.Amt,
  };
}
async function findWooOrderIdByNewebpayNo(merchantOrderNo: string): Promise<number | null> {
  const resp = await axios.get(`${WC_API_BASE}/orders`, {
    auth: { username: WC_CK, password: WC_CS },
    params: { per_page: 50, orderby: "date", order: "desc" },
  });
  const orders = resp.data || [];
  for (const o of orders) {
    const hit = (o.meta_data || []).some(
      (m: any) => m?.key === "newebpay_order_no" && m?.value === merchantOrderNo
    );
    if (hit) return Number(o.id);
  }
  return null;
}

/** ===== 金額處理（分） ===== */
const roundHalfUp = (n: number) => (n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5));
const toCents   = (amount: any) => roundHalfUp(parseFloat(String(amount || 0)) * 100);
const fromCents = (c: number)   => roundHalfUp(c / 100);

async function sendEsimEmail(to: string, orderNumber: string, imagesHtml: string) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: "wandmesim@gmail.com", pass: "hwoywmluqvsuluss" },
  });
  await transporter.sendMail({
    from: `eSIM 團隊 <wandmesim@gmail.com>`,
    to,
    subject: `訂單 ${orderNumber} 的 eSIM QRCode`,
    html: `<p>您好，感謝您的購買！以下是您的 eSIM QRCode：</p><p>${imagesHtml}</p>`,
  });
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

/** 把「已付款後續」抽成共用：產 eSIM + 開發票（與 callback 同步） */
async function fulfillPaidOrder(params: {
  wooBase: string; ck: string; cs: string; orderId: number; fullOrder: any;
  orderNumber: string; result: any; reqId: string;
}) {
  const { wooBase, ck, cs, orderId, fullOrder, orderNumber, result, reqId } = params;

  // 3.2 產 eSIM（若尚未產生）
  const alreadyHasEsim = (fullOrder?.meta_data || []).some((m: any) => m?.key === "esim_qrcodes");
  const qrcodes: { name: string; src: string }[] = [];
  const allImagesHtml: string[] = [];

  if (!alreadyHasEsim) {
    console.log(`[notify:${reqId}] generating eSIM...`);
    for (const li of fullOrder.line_items || []) {
      const planId = li?.meta_data?.find((m: any) => m?.key === "esim_plan_id")?.value;
      const qty    = li?.quantity || 1;
      if (!planId) continue;

      const resolvedPlanId = (PLAN_ID_MAP as any)?.[planId] || planId;
      const { data: esim } = await axios.post(ESIM_PROXY_URL, { channel_dataplan_id: resolvedPlanId, number: qty });

      const list = Array.isArray(esim?.qrcode) ? esim.qrcode : [String(esim?.qrcode)];
      const imagesHtml = list.map((raw: string) => {
        const src = raw.startsWith("http") ? raw : `data:image/png;base64,${raw}`;
        return `<img src="${src}" style="max-width:300px;margin-bottom:10px;" />`;
      }).join("<br />");

      list.forEach((raw: string, i: number) => {
        const src = raw.startsWith("http") ? raw : `data:image/png;base64,${raw}`;
        qrcodes.push({ name: `${li.name} #${i + 1}`, src });
      });

      allImagesHtml.push(`<div><strong>${li.name}</strong><br/>${imagesHtml}</div>`);
      await axios.post(`${wooBase}/orders/${orderId}/notes`,
        { note: `<strong>eSIM QRCode (${li.name}):</strong><br />${imagesHtml}`, customer_note: true },
        { auth: { username: ck, password: cs } }
      );
    }

    if (qrcodes.length) {
      await axios.put(`${wooBase}/orders/${orderId}`,
        { meta_data: [{ key: "esim_qrcodes", value: JSON.stringify(qrcodes) }] },
        { auth: { username: ck, password: cs } }
      );
      const customerEmail: string = fullOrder?.billing?.email;
      if (customerEmail) {
        await sendEsimEmail(customerEmail, orderNumber, allImagesHtml.join("<hr style='margin:16px 0'/>"));
      }
    }
  } else {
    console.log(`[notify:${reqId}] eSIM already existed, skip.`);
  }

  // 3.3 開立電子發票（若尚未開）
  const hasInvoice = (fullOrder?.meta_data || []).some((m: any) => m?.key === "invoice_number");
  if (!hasInvoice) {
    console.log(`[notify:${reqId}] issuing invoice...`);
    const buyerName  = `${fullOrder?.billing?.first_name || ""}${fullOrder?.billing?.last_name || ""}` || "網路訂單";
    const buyerEmail = fullOrder?.billing?.email || "test@example.com";
    const timestamp  = Math.floor(Date.now() / 1000).toString();

    type Row = { name: string; qty: number; subtotalCents: number };
    const rows: Row[] = (fullOrder?.line_items || []).map((li: any) => ({
      name: li.name, qty: li.quantity || 1, subtotalCents: toCents(li.subtotal),
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
      const alloc = idx === rows.length - 1 ? discountCents : Math.min(discountCents, roundHalfUp(discountCents * ratio));
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
      await axios.post(`${wooBase}/orders/${orderId}/notes`,
        { note: `✅ 發票已開立\n發票號碼：${invoiceJson.InvoiceNumber}\n隨機碼：${invoiceJson.RandomNum}\n開立時間：${invoiceJson.CreateTime}`, customer_note: false },
        { auth: { username: ck, password: cs } }
      );
      await axios.put(`${wooBase}/orders/${orderId}`,
        { meta_data: [
          { key: "invoice_number",  value: invoiceJson.InvoiceNumber },
          { key: "invoice_random",  value: invoiceJson.RandomNum },
          { key: "invoice_qrcode_l", value: invoiceJson.QRcodeL },
          { key: "invoice_qrcode_r", value: invoiceJson.QRcodeR },
        ]},
        { auth: { username: ck, password: cs } }
      );
      console.log(`[notify:${reqId}] invoice done.`);
    } else {
      console.error(`[notify:${reqId}] 發票開立失敗：`, invoiceRes.data);
    }
  } else {
    console.log(`[notify:${reqId}] invoice already existed, skip.`);
  }
}

const ntd = (x: any) => `NT$ ${Math.round(Number(x || 0)).toLocaleString("zh-TW")}`;

/* ------------------------- handler ------------------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const hint = String(req.headers["x-vercel-id"] || "");
  const rid = hint ? hint.split("::").pop()! : Math.random().toString(36).slice(2, 10);
  const queryDebug = isOn(req.query.debug);

  res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
  res.setHeader("X-Req-Id", rid);

  if (req.method !== "POST") {
    console.warn(`[notify:${rid}] non-POST hit: method=${req.method}`);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const raw = await readBody(req);
    const ct  = String(req.headers["content-type"] || "");
    const DEBUG = ENV_DEBUG_ON || queryDebug;
    const ECHO_HEADERS = ENV_ECHO_HDR || queryDebug;
    const ECHO_BODY    = ENV_ECHO_BODY || queryDebug;

    const safeHeaders = (() => {
      const pick = ["content-type","x-forwarded-for","x-real-ip","user-agent","x-vercel-id","x-matched-path","x-forwarded-host"];
      const out: Record<string,string> = {};
      pick.forEach(k => { const v = req.headers[k]; if (v) out[k]=String(v); });
      return out;
    })();

    console.log(`[notify:${rid}] hit, ct=${ct}, rawLen=${raw.length}`);
    if (DEBUG && ECHO_HEADERS) console.log(`[notify:${rid}] headers=`, safeHeaders);

    // 只為了讀取 Status 等非密文字段，保留 parse；但 TI/TS 一律走 raw
    const body: any = ct.includes("application/json") ? JSON.parse(raw || "{}") : qs.parse(raw);
    const Status = body?.Status as string | undefined;
    console.log(`[notify:${rid}] parsed body keys=${Object.keys(body || {}).join(",")}`);

    /** ★★★ 從 raw body 直接擷取參數，不讓任何 parser 改動 ★★★ */
    const getParamFromRaw = (name: string): string | undefined => {
      // 僅切出 name= 到下一個 & 之間的原始片段；不把 '+' 轉成空白
      const start = raw.indexOf(`${name}=`);
      if (start < 0) return undefined;
      const s = start + name.length + 1;
      const amp = raw.indexOf("&", s);
      const val = amp === -1 ? raw.slice(s) : raw.slice(s, amp);
      // 只在真的有 % 編碼時，才 decode 一次（避免多重 decode）
      return /%[0-9a-fA-F]{2}/.test(val) ? decodeURIComponent(val) : val;
    };

    const TradeInfo = (getParamFromRaw("TradeInfo") || "").trim();
    const TradeSha  = (getParamFromRaw("TradeSha")  || "").trim();

    const tiLen = TradeInfo.length;
    let shaOk = false;
    if (TradeInfo && TradeSha) {
      shaOk = sha(TradeInfo, HASH_KEY, HASH_IV) === TradeSha;
      console.log(`[notify:${rid}] shaOk=${shaOk}, tiLen=${tiLen}, src=raw-only`);
      if (!shaOk) console.warn(`[notify:${rid}] TradeSha mismatch`);
    } else {
      console.warn(`[notify:${rid}] no TI/TS in raw`);
    }

    // 解密（僅在 shaOk 才解）
    let result: any = null;
    let decryptError: string | null = null;

    if (TradeInfo && shaOk) {
      try {
        const decryptedStr = aesDecryptSafe(TradeInfo, HASH_KEY, HASH_IV);
        const payload = parseDecrypted(decryptedStr);
        result = payload?.Result || null;
        if (DEBUG) {
          const pKeys = Object.keys(payload || {});
          const rKeys = result ? Object.keys(result) : [];
          console.log(`[notify:${rid}] payloadKeys=${pKeys.join(",")}, resultKeys=${rKeys.join(",")}`);
        }
      } catch (e: any) {
        decryptError = e?.message || String(e);
        console.warn(`[notify:${rid}] decrypt error: ${decryptError}`);
      }
    } else if (!TradeInfo && body?.Result) {
      // 僅供你本地 curl 測試；正式來自藍新不會走這裡
      result = body.Result;
      console.log(`[notify:${rid}] using flat Result (test mode)`);
    }

    const merchantOrderNo =
      result?.MerchantOrderNo || body?.MerchantOrderNo || body?.MerchantOrderID || "";

    if (!merchantOrderNo) {
      const preview = raw.slice(0, 512);
      console.warn(`[notify:${rid}] missing MerchantOrderNo. ct=${ct}, shaOk=${shaOk}, tiLen=${tiLen}`);
      if (DEBUG) {
        if (ECHO_BODY) console.log(`[notify:${rid}] raw[0..512]=${preview}`);
        if (ECHO_HEADERS) console.log(`[notify:${rid}] headers(full)=`, safeHeaders);
      }
      return res.status(200).end("OK");
    }

    const wooOrderId = await findWooOrderIdByNewebpayNo(merchantOrderNo);
    if (!wooOrderId) {
      console.warn(`[notify:${rid}] cannot map order: MerchantOrderNo=${merchantOrderNo}`);
      return res.status(200).end("OK");
    }

    // 🧪 進入分支前，寫一筆 DEBUG 備註（Woo）
    try {
      await axios.post(
        `${WC_API_BASE}/orders/${wooOrderId}/notes`,
        {
          note: [
            `🧪 [DEBUG] Newebpay Notify (reqId=${rid})`,
            `Status=${Status || ""}`,
            `shaOk=${shaOk}`,
            `tiLen=${tiLen}`,
            decryptError ? `decryptError=${decryptError}` : "",
            `PaymentType=${String(result?.PaymentType || "")}`,
            `HasPayMoment=${Boolean(hasPayMoment(result))}`,
            `PayTime=${firstPayMoment(result)}`,
          ].filter(Boolean).join("\n"),
          customer_note: false,
        },
        { auth: { username: WC_CK, password: WC_CS } }
      );
    } catch (e) {
      console.warn(`[notify:${rid}] debug note failed:`, (e as any)?.message || e);
    }

    const payType = String(result?.PaymentType || "").toUpperCase();

    /* A) 取號成功（ATM/超商/WebATM）→ on-hold + meta + 備註（冪等） */
    if (isOffsitePending(result)) {
      console.log(`[notify:${rid}] offsite pending branch`);
      const offsite = buildOffsiteInfo(result);

      await axios.put(`${WC_API_BASE}/orders/${wooOrderId}`, {
        status: "on-hold",
        meta_data: [
          { key: "newebpay_offsite_info", value: JSON.stringify(offsite) },
          { key: "newebpay_payment_type", value: payType },
          { key: "newebpay_expire_date",  value: String(offsite?.ExpireDate || "") },
          { key: "newebpay_code_no",      value: String(offsite?.CodeNo || offsite?.PaymentNo || "") },
          { key: "newebpay_bank_code",    value: String(offsite?.BankCode || "") },
        ],
      }, { auth: { username: WC_CK, password: WC_CS } });

      const { data: current } = await axios.get(`${WC_API_BASE}/orders/${wooOrderId}`, {
        auth: { username: WC_CK, password: WC_CS },
      });
      const alreadyNoted = (current?.meta_data || []).some((m: any) => m?.key === "newebpay_offsite_note_v1");

      if (!alreadyNoted) {
        const lines: string[] = [
          `🔔 藍新金流 取號成功（${payType}）`,
          offsite.BankCode ? `銀行代碼：${offsite.BankCode}` : "",
          (offsite.CodeNo || offsite.PaymentNo) ? `轉帳帳號 / 繳費代碼：${offsite.CodeNo || offsite.PaymentNo}` : "",
          offsite.StoreType ? `超商別：${offsite.StoreType}` : "",
          `應繳金額：${ntd(offsite.Amt ?? current?.total)}`,
          offsite.ExpireDate ? `繳費期限：${offsite.ExpireDate}` : "",
          offsite.TradeNo ? `交易序號：${offsite.TradeNo}` : "",
          `商店訂單號：${merchantOrderNo}`,
          "（系統自動加入）",
        ].filter(Boolean);
        await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
          { note: lines.join("\n"), customer_note: false },
          { auth: { username: WC_CK, password: WC_CS } }
        );
        await axios.put(`${WC_API_BASE}/orders/${wooOrderId}`,
          { meta_data: [{ key: "newebpay_offsite_note_v1", value: "1" }] },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      }
    }

    /* B) 已付款（信用卡或 ATM 真入帳）→ processing + 付款 meta + eSIM + 發票（冪等） */
    else if (isPaid(result, Status)) {
      console.log(`[notify:${rid}] paid branch`);
      const { data: current } = await axios.get(`${WC_API_BASE}/orders/${wooOrderId}`, {
        auth: { username: WC_CK, password: WC_CS },
      });
      const alreadyPaid = (current?.meta_data || []).some((m: any) => m?.key === "newebpay_pay_time");

      if (!alreadyPaid) {
        await axios.put(`${WC_API_BASE}/orders/${wooOrderId}`, {
          status: "processing",
          meta_data: [
            { key: "newebpay_trade_no",     value: String(result?.TradeNo || "") },
            { key: "newebpay_pay_time",     value: String(firstPayMoment(result)) },
            { key: "newebpay_payment_type", value: payType },
          ],
        }, { auth: { username: WC_CK, password: WC_CS } });

        const { data: fullOrder } = await axios.get(`${WC_API_BASE}/orders/${wooOrderId}`, {
          auth: { username: WC_CK, password: WC_CS },
        });

        await fulfillPaidOrder({
          wooBase: WC_API_BASE, ck: WC_CK, cs: WC_CS,
          orderId: wooOrderId, fullOrder, orderNumber: merchantOrderNo, result, reqId: rid,
        });

        await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
          { note: `✅ 藍新金流已入帳（${payType}）\n交易序號：${result?.TradeNo || ""}\n入帳時間：${firstPayMoment(result)}`, customer_note: false },
          { auth: { username: WC_CK, password: WC_CS } }
        );
      } else {
        console.log(`[notify:${rid}] already paid, skip.`);
      }
    }

    else {
      console.log(`[notify:${rid}] noop branch:`, { Status, PaymentType: result?.PaymentType });
    }

    return res.status(200).end("OK");
  } catch (e: any) {
    console.error(`[notify:${rid}] error:`, e?.message || e);
    return res.status(200).end("OK"); // 仍回 200 避免藍新重試風暴
  }
}
