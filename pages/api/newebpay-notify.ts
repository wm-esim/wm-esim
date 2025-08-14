// pages/api/newebpay-notify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";

// ✅ 關閉內建 JSON 解析，自己讀 raw（NewebPay 是 x-www-form-urlencoded）
export const config = { api: { bodyParser: false } };

// ✅ 版本號（任意改動方便你辨識新部署）
const NOTIFY_VERSION = "v3.0.1-pages";

// 讀 raw body（不需額外套件）
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function aesDecrypt(hex: string, key: string, iv: string) {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8")
  );
  decipher.setAutoPadding(true);
  let out = decipher.update(hex, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
}

// 你的金鑰
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV  = "PKetlaZYZcZvlMmC";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 永遠不要 3xx，也不要 4xx/5xx；方法不符才 405
  if (req.method !== "POST") {
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const raw = await readBody(req);
    const ct = String(req.headers["content-type"] || "");

    // 解析 body
    const body: any = ct.includes("application/json")
      ? JSON.parse(raw || "{}")
      : qs.parse(raw);

    const TradeInfo = body?.TradeInfo as string | undefined;
    const Status    = body?.Status as string | undefined;

    let parsed: Record<string, string> | null = null;

    // 嘗試解密（不是 hex 就略過）
    if (TradeInfo && /^[0-9a-fA-F]+$/.test(TradeInfo)) {
      try {
        const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
        const params = new URLSearchParams(decrypted);
        parsed = {};
        params.forEach((v, k) => (parsed![k] = v));
      } catch (e: any) {
        console.warn("[notify] decrypt failed:", e?.message || e);
      }
    } else {
      console.warn("[notify] no/invalid TradeInfo:", TradeInfo);
    }

    console.log("[notify] hit", {
      ver: NOTIFY_VERSION,
      Status,
      hasParsed: !!parsed,
    });

    // ===== 這裡接你的 Woo + eSIM + 發票流程（包 try/catch；出錯只記錄，仍回 200）=====
    // try { ... } catch (e) { console.error("[notify] post-process error:", e); }

    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK");
  } catch (e: any) {
    console.error("[notify] handler error:", e?.message || e);
    res.setHeader("X-Notify-Rev", NOTIFY_VERSION);
    return res.status(200).end("OK");
  }
}
