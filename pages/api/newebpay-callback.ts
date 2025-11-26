// /pages/api/newebpay-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";

// 既然 Notify 成功了，我們就只鎖定這組正確的金鑰
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV  = "PKetlaZYZcZvlMmC";

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

function decryptTradeInfo(ti: string, key: string, iv: string): string {
  // 嘗試基本修復
  const clean = ti.replace(/\s/g, "+");
  const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
  d.setAutoPadding(true);
  let out = d.update(clean, "hex", "utf8");
  out += d.final("utf8");
  return out;
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
    
    // 嘗試解密
    let orderNo = "";
    let nextStatus = "success"; // 預設給成功，因為 Notify 通常會處理好狀態

    try {
      if (TI_raw) {
        // 嘗試 URL Decode 之後再解
        let candidate = TI_raw;
        if (TI_raw.includes("%")) {
            try { candidate = decodeURIComponent(TI_raw); } catch {}
        }
        
        const plain = decryptTradeInfo(candidate, HASH_KEY, HASH_IV);
        const payload = parseDecrypted(plain);
        const result = payload?.Result || {};
        orderNo = result?.MerchantOrderNo || body?.MerchantOrderNo || "";
      }
    } catch (e) {
      console.error("Callback 解密失敗，啟用前端備援機制:", e);
      // ★★★ 關鍵點：如果解密失敗，不跳 Error，而是跳轉到前端並告訴它「去讀 LocalStorage」 ★★★
      return res.redirect(302, `/thank-you?status=success&orderNo=LOCAL_BACKUP`);
    }

    if (!orderNo) {
       // 如果解開了但沒單號，也啟用備援
       return res.redirect(302, `/thank-you?status=success&orderNo=LOCAL_BACKUP`);
    }

    // 正常解開的情況
    return res.redirect(302, `/thank-you?status=success&orderNo=${orderNo}`);

  } catch (e: any) {
    // 發生嚴重錯誤時，也嘗試啟用備援
    console.error("Callback Fatal Error", e);
    return res.redirect(302, `/thank-you?status=success&orderNo=LOCAL_BACKUP`);
  }
}