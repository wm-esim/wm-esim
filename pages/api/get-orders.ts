import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import crypto from "crypto";
import qs from "qs";

/** ====== ENV ====== */
const WC_BASE = process.env.WC_BASE || "https://fegoesim.com";
const WC_API = `${WC_BASE}/wp-json/wc/v3/orders`;
const WC_CK = process.env.WC_CK || process.env.NEXT_PUBLIC_WC_CONSUMER_KEY!;
const WC_CS = process.env.WC_CS || process.env.NEXT_PUBLIC_WC_CONSUMER_SECRET!;

const NEWEBPAY_BASE = process.env.NEWEBPAY_BASE || "https://core.newebpay.com";
const NEWEBPAY_QUERY_URL = `${NEWEBPAY_BASE}/API/QueryTradeInfo`;
const MERCHANT_ID = process.env.NEWEBPAY_MERCHANT_ID!;
const HASH_KEY = process.env.NEWEBPAY_HASH_KEY!;
const HASH_IV = process.env.NEWEBPAY_HASH_IV!;

/** ====== helpers ====== */
const log  = (...a: any[]) => console.log("[get-orders]", ...a);
const warn = (...a: any[]) => console.warn("[get-orders]", ...a);
const err  = (...a: any[]) => console.error("[get-orders]", ...a);

/** 產生 QueryTradeInfo 的 CheckValue（見 NDNF 4.1.6） */
function makeCheckValue(amt: number | string, merchantOrderNo: string) {
  const A = String(Math.round(Number(amt)));
  // 依 A~Z 排序：Amt, MerchantID, MerchantOrderNo
  const data1 = `Amt=${A}&MerchantID=${MERCHANT_ID}&MerchantOrderNo=${merchantOrderNo}`;
  const s = `IV=${HASH_IV}&${data1}&Key=${HASH_KEY}`;
  return crypto.createHash("sha256").update(s).digest("hex").toUpperCase();
}

/** 呼叫藍新 單筆交易查詢（以 MerchantOrderNo 查） */
async function queryNewebpayByOrderNo(merchantOrderNo: string, amt: number | string) {
  const form = qs.stringify({
    MerchantID: MERCHANT_ID,
    Version: "1.3",
    RespondType: "JSON",
    MerchantOrderNo: merchantOrderNo,
    Amt: Math.round(Number(amt)),
    CheckValue: makeCheckValue(amt, merchantOrderNo),
  });

  try {
    const { data } = await axios.post(NEWEBPAY_QUERY_URL, form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    });

    // 回傳有時是 JSON，也可能包在 data.Result/字串，兩種都兼容
    const payload = typeof data === "string" ? JSON.parse(data) : data;
    if (payload?.Status !== "SUCCESS") {
      warn("[newebpay] query FAIL", { merchantOrderNo, msg: payload?.Message });
      return null;
    }
    const r = payload?.Result || {};
    // 同一化欄位 + 只回離線取號類型
    const type = String(r.PaymentType || "").toUpperCase();
    if (!["VACC", "CVS", "WEBATM"].includes(type)) {
      // 非離線取號（例：CREDIT），就不當作 offsite。
      return null;
    }
    return {
      PaymentType: type,
      BankCode: r.BankCode || r.BankNo,
      CodeNo: r.CodeNo || r.ATMAccNo || r.PaymentNo,
      PaymentNo: r.PaymentNo,
      StoreType: r.StoreType,
      ExpireDate: r.ExpireDate || r.ExpireTime,
      TradeNo: r.TradeNo,
      Amt: r.Amt ?? amt,
      PayTime: r.PayTime || "", // 有 PayTime 代表已繳
    };
  } catch (e: any) {
    err("[newebpay] query ERROR", merchantOrderNo, e?.message);
    return null;
  }
}

/** 從 Woo 取某個 meta 值 */
const mval = (order: any, key: string) =>
  (order?.meta_data || []).find((m: any) => m?.key === key)?.value;

/** 對單筆訂單補上 offsiteInfo（若需要） */
async function attachOffsiteIfNeeded(order: any) {
  const status = String(order?.status || "");
  if (!["pending", "on_hold"].includes(status)) return order;

  // 先看 API 端是不是已經組好（之後你若改別的來源，也不動前端）
  if (order?.offsiteInfo) return order;

  // 拿 Woo 的 newebpay_order_no 來查藍新
  const merchantOrderNo =
    mval(order, "newebpay_order_no") ||
    mval(order, "MerchantOrderNo") ||
    null;

  if (!merchantOrderNo) {
    log(`#${order.id} 無 newebpay_order_no，跳過 Query`);
    return order;
  }

  const info = await queryNewebpayByOrderNo(merchantOrderNo, order.total);
  log(
    `[newebpay] #${order.id} 查詢結果`,
    JSON.stringify({ merchantOrderNo, hasOffsite: !!info, paymentType: info?.PaymentType || "-" })
  );

  return {
    ...order,
    offsiteInfo: info || null,
    paymentType: info?.PaymentType || order?.paymentType || "",
  };
}

/** 取得會員訂單（userId 優先；無 userId 則用 email 過濾） */
async function fetchWooOrders(userId?: string, email?: string) {
  const params: any = {
    per_page: 100,
    status: "any",
  };
  if (userId) params.customer = userId;

  const { data } = await axios.get(WC_API, {
    auth: { username: WC_CK, password: WC_CS },
    params,
  });

  let orders = Array.isArray(data) ? data : [];

  if (!userId && email) {
    orders = orders.filter((o: any) => (o?.billing?.email || "").toLowerCase() === email.toLowerCase());
  }

  // 簡易摘要 log
  orders.forEach((o: any) => {
    const type = mval(o, "newebpay_payment_type") || o.payment_method_title || "";
    const hasOffsiteMeta = !!mval(o, "newebpay_offsite_info");
    log(`#${o.id} | 狀態:${o.status} | customer_id:${o.customer_id} | offsiteMeta:${hasOffsiteMeta ? "Y" : "N"} | paymentType:${type}`);
  });

  return orders;
}

/** ====== handler ====== */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId, email } = req.query as { userId?: string; email?: string };

  if (!userId && !email) {
    return res.status(400).json({ error: "缺少 userId 或 email" });
  }

  try {
    log("入參", { userId, email });

    const orders = await fetchWooOrders(userId, email);

    // 只對待繳訂單查藍新，其他直接回傳
    const out: any[] = [];
    for (const o of orders) {
      out.push(await attachOffsiteIfNeeded(o));
    }

    log("回傳筆數：", out.length);
    return res.status(200).json(out);
  } catch (e: any) {
    err("API 例外", e?.message);
    return res.status(500).json({ error: "訂單查詢失敗", detail: e?.message || String(e) });
  }
}
