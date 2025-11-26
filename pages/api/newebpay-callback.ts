// /pages/api/newebpay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";

// ★★★ 定義兩組金鑰 (自動輪詢) ★★★
const KEY_SETS = [
  {
    // 第一組：寫在 order.ts 裡的那組 (目前最可能是這組)
    key: "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx",
    iv:  "PKetlaZYZcZvlMmC",
    name: "Hardcoded-MS3788"
  },
  {
    // 第二組：Vercel 環境變數裡的那組 (備用)
    key: "pwFHCqoQZGmho4w6",
    iv:  "EkRm7iFT261dpevs",
    name: "Env-3002607"
  }
];

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

/** 解密核心 */
function decryptTradeInfo(ti: string, key: string, iv: string): string {
  const tryHex = () => {
    const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
    d.setAutoPadding(true);
    let out = d.update(ti, "hex", "utf8");
    out += d.final("utf8");
    return out;
  };
  const tryB64 = () => {
    const norm = ti.replace(/\s+/g, "+").replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm + "===".slice((norm.length + 3) % 4);
    const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
    d.setAutoPadding(true);
    let out = d.update(padded, "base64", "utf8");
    out += d.final("utf8");
    return out;
  };

  if (/^[0-9a-fA-F]+$/.test(ti) && ti.length % 2 === 0) {
    try { return tryHex(); } catch { return tryB64(); }
  }
  try { return tryB64(); } catch { return tryHex(); }
}

function parseDecrypted(text: string): any {
  try {
    const obj = JSON.parse(text);
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
      return res.redirect(302, `/thank-you?status=error&msg=MissingParams`);
    }

    // 候選字串
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

    // ★★★ 核心修改：輪詢所有金鑰，直到解開為止 ★★★
    let validKeySet = null;
    let TradeInfo = "";

    // 1. 先找哪組 Key 能通過 SHA 驗證
    for (const set of KEY_SETS) {
      for (const cand of tiCandidates) {
        if (sha(cand, set.key, set.iv) === TS_raw) {
          validKeySet = set;
          TradeInfo = cand;
          break;
        }
      }
      if (validKeySet) break;
    }

    if (!validKeySet || !TradeInfo) {
      console.error("所有金鑰皆無法通過 SHA 驗證");
      return res.redirect(302, `/thank-you?status=error&msg=ShaMismatch_AllKeysFailed`);
    }

    console.log(`✅ 使用金鑰組 [${validKeySet.name}] 驗證成功`);

    // 2. 解密
    let payload: any = {};
    try {
      const plain = decryptTradeInfo(TradeInfo, validKeySet.key, validKeySet.iv);
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

    let nextStatus = "fail";
    if (isPaid(result, status)) nextStatus = "success";
    else if (isOffsitePending(result)) nextStatus = "pending";

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