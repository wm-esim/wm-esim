// /pages/api/newebpay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";

// ★★★ 修正：這裡改成跟你 order.ts 一模一樣的正確金鑰 ★★★
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

export const config = { api: { bodyParser: false } };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sha(encrypted: string, key: string, iv: string) {
  const s = `HashKey=${key}&${encrypted}&HashIV=${iv}`;
  return crypto.createHash("sha256").update(s).digest("hex").toUpperCase();
}

/** 寬容解密：支援 Hex, Base64 以及自動修復 + 號空白問題 */
function decryptTradeInfo(ti: string, key: string, iv: string): string {
  const tryHex = () => {
    const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    d.setAutoPadding(true);
    let out = d.update(ti, "hex", "utf8");
    out += d.final("utf8");
    return out;
  };
  const tryB64 = () => {
    // 修復 URL Encoding 可能把 + 變空白的問題
    const norm = ti.replace(/\s+/g, "+").replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm + "===".slice((norm.length + 3) % 4);
    const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
    d.setAutoPadding(true);
    let out = d.update(padded, "base64", "utf8");
    out += d.final("utf8");
    return out;
  };

  // 嘗試自動判斷格式
  if (/^[0-9a-fA-F]+$/.test(ti) && ti.length % 2 === 0) {
    try { return tryHex(); } catch { return tryB64(); }
  }
  try { return tryB64(); } catch { return tryHex(); }
}

function parseDecrypted(text: string): any {
  try {
    const obj = JSON.parse(text);
    // 處理 Result 可能是字串也可能是物件的情況
    if (obj && typeof obj.Result === "string") {
      try { obj.Result = JSON.parse(obj.Result); } catch { obj.Result = qs.parse(obj.Result); }
    }
    return obj;
  } catch {
    const r: any = qs.parse(text);
    if (r?.Result && typeof r.Result === "string") {
      try { r.Result = JSON.parse(r.Result); } catch { r.Result = qs.parse(r.Result); }
    }
    return r;
  }
}

function hasPayMoment(result: any) {
  return !!(result?.PayTime || result?.PaymentTime || result?.PayDate || result?.CloseTime);
}
function firstPayMoment(result: any) {
  return (result?.PayTime || result?.PaymentTime || result?.PayDate || result?.CloseTime || "");
}
function isPaid(result: any, status?: string) {
  const t = String(result?.PaymentType || "").toUpperCase();
  const paid = hasPayMoment(result);
  if (t === "CREDIT") return status === "SUCCESS" || paid;
  return paid;
}
function isOffsitePending(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  return (t === "VACC" || t === "CVS" || t === "WEBATM") && !hasPayMoment(result);
}

/** ========== handler ========== */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const raw = await readBody(req);
    const ct = String(req.headers["content-type"] || "");
    const body: any = ct.includes("application/json") ? JSON.parse(raw || "{}") : qs.parse(raw);

    // 取得原始參數 (用 raw parsing 最保險)
    const getRawParam = (name: string): string | undefined => {
      const start = raw.indexOf(`${name}=`);
      if (start < 0) return undefined;
      const s = start + name.length + 1;
      const amp = raw.indexOf("&", s);
      return (amp === -1 ? raw.slice(s) : raw.slice(s, amp)).trim();
    };

    const TI_raw = getRawParam("TradeInfo") || String(body?.TradeInfo || "");
    const TS_raw = getRawParam("TradeSha") || String(body?.TradeSha || "");

    if (!TI_raw || !TS_raw) {
      console.error("Callback 缺少參數");
      return res.redirect(302, `/thank-you?status=error&msg=MissingParams`);
    }

    // 產生候選字串 (原始 vs urldecode vs 補+)
    const tiCandidates = (() => {
      const out: string[] = [];
      const hasPct = /%[0-9a-fA-F]{2}/.test(TI_raw);
      out.push(TI_raw);
      if (hasPct) { try { out.push(decodeURIComponent(TI_raw)); } catch {} }
      if (!hasPct && /\s/.test(TI_raw)) {
        const restored = TI_raw.replace(/\s/g, "+");
        out.push(restored);
        try { out.push(decodeURIComponent(restored)); } catch {}
      }
      return Array.from(new Set(out.filter(Boolean)));
    })();

    // 驗證 SHA (這步最關鍵，現在 Key 對了應該就會過)
    let TradeInfo = "";
    for (const c of tiCandidates) {
      if (sha(c, HASH_KEY, HASH_IV) === TS_raw) {
        TradeInfo = c;
        break;
      }
    }

    if (!TradeInfo) {
      console.error(`SHA Mismatch. Key used: ${HASH_KEY.slice(0,4)}...`);
      return res.redirect(302, `/thank-you?status=error&msg=ShaMismatch`);
    }

    // 解密
    let payload: any = {};
    try {
      const plain = decryptTradeInfo(TradeInfo, HASH_KEY, HASH_IV);
      payload = parseDecrypted(plain) || {};
    } catch {
      return res.redirect(302, `/thank-you?status=error&msg=DecryptFail`);
    }

    const status = (payload?.Status as string) || (body?.Status as string) || "FAIL";
    const result = payload?.Result || {};
    const orderNo = result?.MerchantOrderNo || body?.MerchantOrderNo || "";

    if (!orderNo) {
      return res.redirect(302, `/thank-you?status=error&msg=NoOrderNo`);
    }

    // 判斷狀態
    let nextStatus = "fail";
    if (isPaid(result, status)) nextStatus = "success";
    else if (isOffsitePending(result)) nextStatus = "pending";

    // 導回 Thank You Page，帶上 orderNo，這樣你的前端就能抓到 QRCode 了
    const qsExtra = new URLSearchParams({
      orderNo,
      status: nextStatus,
      paymentType: String(result?.PaymentType || ""),
      payTime: firstPayMoment(result),
      tradeNo: String(result?.TradeNo || ""),
    }).toString();

    return res.redirect(302, `/thank-you?${qsExtra}`);

  } catch (e: any) {
    console.error("Callback Error", e);
    return res.redirect(302, `/thank-you?status=error&msg=${encodeURIComponent(e.message)}`);
  }
}