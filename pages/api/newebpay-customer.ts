// /pages/api/newebpay-customer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import qs from "qs";
import axios from "axios";

export const config = { api: { bodyParser: false } };

const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV  = "PKetlaZYZcZvlMmC";

const WC_API_BASE = "https://fegoesim.com/wp-json/wc/v3";
const WC_CK = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_CS = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

/* ---------------- utils ---------------- */
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
/** callback 固定 hex 解 */
function aesDecryptHexFirst(encryptedHex: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  decipher.setAutoPadding(true);
  let out = decipher.update(encryptedHex, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
}
/** 自動判斷 hex/base64 */
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
function isOffsitePending(result: any) {
  const t = String(result?.PaymentType || "").toUpperCase();
  return t === "VACC" || t === "CVS" || t === "WEBATM";
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

/* ---------------- handler ---------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rid = Math.random().toString(36).slice(2, 10);

  if (req.method !== "POST") {
    res.writeHead(302, { Location: "/" }).end();
    return;
  }

  try {
    const raw = await readBody(req);
    const queryOrderNo = Array.isArray(req.query.orderNo) ? req.query.orderNo[0] : (req.query.orderNo as string | undefined) || "";

    const getRaw = (name: string): string => {
      const i = raw.indexOf(`${name}=`);
      if (i < 0) return "";
      const s = i + name.length + 1;
      const e = raw.indexOf("&", s);
      return (e === -1 ? raw.slice(s) : raw.slice(s, e)).trim();
    };
    const TI_raw = getRaw("TradeInfo");
    const TS_raw = getRaw("TradeSha");

    // 候選組合
    const getTIcandidates = (ti: string): string[] => {
      const out: string[] = [];
      const hasPct = /%[0-9a-fA-F]{2}/.test(ti);
      out.push(ti);
      if (hasPct) { try { out.push(decodeURIComponent(ti)); } catch {} }
      if (!hasPct && /\s/.test(ti)) {
        const restored = ti.replace(/\s/g, "+");
        out.push(restored);
        try { out.push(decodeURIComponent(restored)); } catch {}
      }
      return Array.from(new Set(out.filter(Boolean)));
    };
    const TI_candidates = getTIcandidates(TI_raw);

    // SHA 驗證
    let TradeInfo = "";
    let shaOk = false;
    for (const cand of TI_candidates) {
      if (sha(cand, HASH_KEY, HASH_IV) === TS_raw) { TradeInfo = cand; shaOk = true; break; }
    }

    // 解密流程
    let result: any = null;
    let decryptError: string | null = null;

    const tryDecryptAny = (cands: string[]) => {
      for (const ti of cands) {
        // 1) 固定 hex
        if (/^[0-9a-fA-F]+$/.test(ti)) {
          try {
            const text = aesDecryptHexFirst(ti, HASH_KEY, HASH_IV);
            const obj  = parseDecrypted(text);
            if (obj?.Result) return obj.Result;
          } catch (e: any) { decryptError = e.message; }
        }
        // 2) base64
        try {
          const b64 = ti.replace(/\s+/g, "+").replace(/-/g, "+").replace(/_/g, "/");
          const padded = b64 + "===".slice((b64.length + 3) % 4);
          const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(HASH_KEY, "utf8"), Buffer.from(HASH_IV, "utf8"));
          decipher.setAutoPadding(true);
          let out = decipher.update(padded, "base64", "utf8");
          out += decipher.final("utf8");
          const obj = parseDecrypted(out);
          if (obj?.Result) return obj.Result;
        } catch (e: any) { decryptError = e.message; }
        // 3) safe
        try {
          const text = aesDecryptSafe(ti, HASH_KEY, HASH_IV);
          const obj  = parseDecrypted(text);
          if (obj?.Result) return obj.Result;
        } catch (e: any) { decryptError = e.message; }
      }
      return null;
    };

    if (shaOk && TradeInfo) result = tryDecryptAny([TradeInfo]);
    if (!result) result = tryDecryptAny(TI_candidates);

    let orderNo = queryOrderNo || "";
    if (result?.MerchantOrderNo) orderNo = String(result.MerchantOrderNo);

    if (!orderNo) {
      console.warn(`[customer:${rid}] missing orderNo`);
      return res.writeHead(302, { Location: `/pending` }).end();
    }

    const wooOrderId = await findWooOrderIdByNewebpayNo(orderNo);
    if (!wooOrderId) {
      console.warn(`[customer:${rid}] cannot map Woo order for ${orderNo}`);
      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}&refresh=1` }).end();
    }

    if (!result) {
      await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
        { note: `🧪 [DEBUG2] Newebpay Customer (reqId=${rid})\nshaOk=${shaOk}\ndecryptError=${decryptError || "unknown"}`, customer_note: false },
        { auth: { username: WC_CK, password: WC_CS } }
      );
      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}&refresh=1` }).end();
    }

    if (isOffsitePending(result)) {
      const offsite = buildOffsiteInfo(result);
      await axios.put(`${WC_API_BASE}/orders/${wooOrderId}`, {
        status: "on-hold",
        meta_data: [
          { key: "newebpay_offsite_info", value: JSON.stringify(offsite) },
          { key: "newebpay_payment_type", value: offsite.PaymentType },
          { key: "newebpay_expire_date",  value: String(offsite?.ExpireDate || "") },
          { key: "newebpay_code_no",      value: String(offsite?.CodeNo || offsite?.PaymentNo || "") },
          { key: "newebpay_bank_code",    value: String(offsite?.BankCode || "") },
        ],
      }, { auth: { username: WC_CK, password: WC_CS } });

      const lines = [
        `🔔 藍新金流 取號成功（${offsite.PaymentType}）`,
        offsite.BankCode ? `銀行代碼：${offsite.BankCode}` : "",
        (offsite.CodeNo || offsite.PaymentNo) ? `轉帳帳號 / 繳費代碼：${offsite.CodeNo || offsite.PaymentNo}` : "",
        offsite.StoreType ? `超商別：${offsite.StoreType}` : "",
        offsite.ExpireDate ? `繳費期限：${offsite.ExpireDate}` : "",
        offsite.TradeNo ? `交易序號：${offsite.TradeNo}` : "",
        `商店訂單號：${orderNo}`,
        "（CustomerURL 寫入）",
      ].filter(Boolean).join("\n");

      await axios.post(`${WC_API_BASE}/orders/${wooOrderId}/notes`,
        { note: lines, customer_note: false },
        { auth: { username: WC_CK, password: WC_CS } }
      );

      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}` }).end();
    }

    return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}` }).end();
  } catch (e: any) {
    console.error(`[customer] error:`, e?.message || e);
    return res.writeHead(302, { Location: `/pending` }).end();
  }
}
