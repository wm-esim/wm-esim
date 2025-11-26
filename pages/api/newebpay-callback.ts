// /pages/api/newebpay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";

// 定義金鑰組
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

// ★★★ 關鍵修復：手動處理 Padding，解決 bad_decrypt 問題 ★★★
function decryptWithManualPadding(encrypted: string, key: string, iv: string) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
  
  // 1. 關閉自動 Padding (這是解決 1C800064 的關鍵)
  decipher.setAutoPadding(false);
  
  // 2. 解密
  let text = decipher.update(encrypted, "hex", "utf8");
  text += decipher.final("utf8");

  // 3. 手動移除 PKCS7 Padding
  // 取得最後一個字元的 char code
  const lastChar = text.charCodeAt(text.length - 1);
  
  // PKCS7 Padding 的特徵：最後一個 byte 的值，代表 padding 的長度 (通常在 1~32 之間)
  if (lastChar > 0 && lastChar <= 32) {
    // 檢查結尾是否真的都是這個值 (雙重確認)
    const padding = text.slice(-lastChar);
    if (padding.split('').every(c => c.charCodeAt(0) === lastChar)) {
      return text.slice(0, -lastChar); // 移除 padding
    }
  }
  
  // 如果看起來不像 padding，就回傳原文 (有些特殊情況可能沒有 padding)
  return text.replace(/[\x00-\x1F\x7F-\x9F]/g, ""); 
}

function decryptTradeInfo(ti: string, key: string, iv: string): string {
  // 嘗試多種輸入格式
  const candidates = [
    ti,
    ti.replace(/\s/g, "+"), // 補回被吃掉的加號
    decodeURIComponent(ti),
    decodeURIComponent(ti).replace(/\s/g, "+")
  ];

  for (const c of candidates) {
    try {
      // 嘗試用標準方法解
      const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
      d.setAutoPadding(true);
      let out = d.update(c, "hex", "utf8");
      out += d.final("utf8");
      if (out.includes("{") || out.includes("=")) return out;
    } catch (e) {
      // 標準方法失敗，改用手動 Padding 方法
      try {
        const out = decryptWithManualPadding(c, key, iv);
        if (out.includes("{") || out.includes("=")) return out;
      } catch (e2) {}
    }
  }
  throw new Error("Unable to decrypt with any method");
}

function parseDecrypted(text: string): any {
  // 清理可能殘留的控制字元
  const clean = text.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
  try {
    const obj = JSON.parse(clean);
    if (obj && typeof obj.Result === "string") {
      try { obj.Result = JSON.parse(obj.Result); } catch { obj.Result = qs.parse(obj.Result); }
    }
    return obj;
  } catch {
    const r: any = qs.parse(clean);
    if (r?.Result && typeof r.Result === "string") {
      try { r.Result = JSON.parse(r.Result); } catch { r.Result = qs.parse(r.Result); }
    }
    return r;
  }
}

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

    // SHA 驗證
    let validKeySet = null;
    let TradeInfoCandidate = "";

    // 準備候選人
    const tiCandidates = [
        TI_raw,
        decodeURIComponent(TI_raw),
        TI_raw.replace(/\s/g, "+"),
        decodeURIComponent(TI_raw).replace(/\s/g, "+")
    ];
    const uniqueCandidates = Array.from(new Set(tiCandidates));

    for (const set of KEY_SETS) {
      for (const cand of uniqueCandidates) {
        if (sha(cand, set.key, set.iv) === TS_raw) {
          validKeySet = set;
          TradeInfoCandidate = cand;
          break;
        }
      }
      if (validKeySet) break;
    }

    if (!validKeySet || !TradeInfoCandidate) {
      console.error("SHA 驗證失敗");
      return res.redirect(302, `/thank-you?status=error&msg=ShaMismatch`);
    }

    // 解密
    let payload: any = {};
    try {
      const plain = decryptTradeInfo(TradeInfoCandidate, validKeySet.key, validKeySet.iv);
      payload = parseDecrypted(plain) || {};
    } catch (e: any) {
      console.error("解密失敗:", e);
      return res.redirect(302, `/thank-you?status=error&msg=DecryptFail`);
    }

    const result = payload?.Result || {};
    const orderNo = result?.MerchantOrderNo || body?.MerchantOrderNo || "";

    if (!orderNo) {
      return res.redirect(302, `/thank-you?status=error&msg=NoOrderNo`);
    }

    // 成功！
    const qsExtra = new URLSearchParams({
      orderNo,
      status: "success", // 這裡直接給 success，因為 Notify 已經處理好訂單狀態了
    }).toString();

    return res.redirect(302, `/thank-you?${qsExtra}`);

  } catch (e: any) {
    console.error("Callback Fatal Error", e);
    return res.redirect(302, `/thank-you?status=error&msg=${encodeURIComponent(e.message)}`);
  }
}