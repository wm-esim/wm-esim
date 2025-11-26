// /pages/api/newebpay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";

// 定義兩組金鑰 (自動輪詢)
const KEY_SETS = [
  {
    key: "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx",
    iv:  "PKetlaZYZcZvlMmC",
    name: "Hardcoded-MS3788"
  },
  {
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

// ★★★ 強壯版解密函式：自動嘗試多種格式 ★★★
function decryptTradeInfo(ti: string, key: string, iv: string): string {
  // 1. 定義各種可能的格式處理方式
  const attempts = [
    (t: string) => t, // 原文
    (t: string) => t.replace(/\s/g, "+"), // 修復空白
    (t: string) => decodeURIComponent(t), // URL Decode
    (t: string) => decodeURIComponent(t).replace(/\s/g, "+") // 混合
  ];

  let lastError: any = null;

  for (const modify of attempts) {
    const candidate = modify(ti);
    
    // 嘗試 Hex 解密
    try {
      const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
      d.setAutoPadding(true);
      let out = d.update(candidate, "hex", "utf8");
      out += d.final("utf8");
      // 簡單驗證解出來是不是 JSON 或 QueryString
      if (out.includes("{") || out.includes("=")) return out; 
    } catch (e) { lastError = e; }

    // 嘗試 Base64 解密
    try {
      const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
      d.setAutoPadding(true);
      let out = d.update(candidate, "base64", "utf8");
      out += d.final("utf8");
      if (out.includes("{") || out.includes("=")) return out;
    } catch (e) { lastError = e; }
  }

  // 如果都失敗，拋出最後一個錯誤
  throw lastError || new Error("Decrypt failed with all attempts");
}

function parseDecrypted(text: string): any {
  // 移除可能存在的 Padding 亂碼 (雖有 autoPadding，但有時會有殘留)
  const cleanText = text.replace(/[\x00-\x1F\x7F-\x9F]/g, ""); 
  
  try {
    const obj = JSON.parse(cleanText);
    if (obj && typeof obj.Result === "string") {
      try { obj.Result = JSON.parse(obj.Result); } catch { obj.Result = qs.parse(obj.Result); }
    }
    return obj;
  } catch {
    const r: any = qs.parse(cleanText);
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

    // SHA 驗證 (尋找正確金鑰)
    let validKeySet = null;
    let TradeInfo = "";

    // 準備多種格式的 TradeInfo 候選人
    const tiCandidates = [
        TI_raw,
        decodeURIComponent(TI_raw),
        TI_raw.replace(/\s/g, "+"),
        decodeURIComponent(TI_raw).replace(/\s/g, "+")
    ];
    // 去重複
    const uniqueCandidates = Array.from(new Set(tiCandidates));

    for (const set of KEY_SETS) {
      for (const cand of uniqueCandidates) {
        // console.log(`Checking SHA with key ${set.name}...`); // debug 用
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
      return res.redirect(302, `/thank-you?status=error&msg=ShaMismatch`);
    }

    console.log(`✅ [Callback] 使用金鑰 [${validKeySet.name}] 驗證成功，準備解密...`);

    // 解密
    let payload: any = {};
    try {
      const plain = decryptTradeInfo(TradeInfo, validKeySet.key, validKeySet.iv);
      console.log("✅ 解密成功 (前20字):", plain.slice(0, 20));
      payload = parseDecrypted(plain) || {};
    } catch (e: any) {
      console.error("❌ 解密失敗:", e.message);
      // 把錯誤訊息帶回前端，方便看
      return res.redirect(302, `/thank-you?status=error&msg=DecryptFail_${e.message.replace(/\s/g, '_')}`);
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