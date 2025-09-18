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

/** 官方文檔：AES-256-CBC + PKCS7 → Hex */
function aes256cbcDecryptHexPkcs7(hex: string, key: string, iv: string): string {
  const encrypted = Buffer.from(hex.trim(), "hex");

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8")
  );
  // 關閉自動 padding，自行剝 PKCS7
  decipher.setAutoPadding(false);

  const decryptedBuf = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const pad = decryptedBuf[decryptedBuf.length - 1];
  if (pad < 1 || pad > 16) throw new Error(`Invalid PKCS7 padding length: ${pad}`);
  const data = decryptedBuf.slice(0, decryptedBuf.length - pad);

  return data.toString("utf8");
}

/** 官方 Result 格式：可能是 JSON 或 querystring，且 Result 可能再包一層字串 */
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

    // 先檢查 SHA
    let result: any = null;
    if (TI_raw && sha(TI_raw, HASH_KEY, HASH_IV) === TS_raw) {
      try {
        const decrypted = aes256cbcDecryptHexPkcs7(TI_raw, HASH_KEY, HASH_IV);
        const payload = parseDecrypted(decrypted);
        result = payload?.Result ?? null;
      } catch (e: any) {
        await axios.post(`${WC_API_BASE}/orders`, {
          note: `🧪 [DEBUG] Newebpay Customer (reqId=${rid})\nshaOk=true\nTI_len=${TI_raw.length}\nerror=${e.message}`,
          customer_note: false,
        }, { auth: { username: WC_CK, password: WC_CS } });
      }
    }

    // orderNo：先用 query 備援
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
        { note: `🧪 [DEBUG] Newebpay Customer (reqId=${rid})\nshaOk=false 或解密失敗`, customer_note: false },
        { auth: { username: WC_CK, password: WC_CS } }
      );
      return res.writeHead(302, { Location: `/pending?orderNo=${encodeURIComponent(orderNo)}&refresh=1` }).end();
    }

    // ATM/超商/WebATM → on-hold + 備註
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
