// /pages/api/fetch-order.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const WC_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

type QrcodeInfo = { name: string; src: string };

function normalizeSrc(raw: any): string {
  const str = String(raw || "");
  if (!str) return "";
  return str.startsWith("http") || str.startsWith("data:image/")
    ? str
    : `data:image/png;base64,${str}`;
}

function computeIsPaid(order: any): boolean {
  const s = String(order?.status || "").toLowerCase();
  if (s === "processing" || s === "completed") return true;
  if (order?.date_paid) return true;

  const meta: any[] = order?.meta_data || [];
  const payTime = meta.find((m) => m?.key === "newebpay_pay_time")?.value;
  if (payTime) return true;

  const txn = order?.transaction_id;
  if (txn && String(txn).trim()) return true;

  return false;
}

function statusLabel(order: any): string {
  const s = String(order?.status || "").toLowerCase();
  switch (s) {
    case "processing":
    case "completed":
      return "SUCCESS";
    case "on-hold":
      return "PENDING";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    default:
      return s || "UNKNOWN";
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  let { orderNo } = req.query as { orderNo?: string };
  if (!orderNo || typeof orderNo !== "string") {
    return res.status(400).json({ error: "缺少訂單編號（orderNo）" });
  }
  orderNo = orderNo.replace(/[&/\\]/g, "-");

  try {
    // 1) 用我們自訂 meta：newebpay_order_no 找訂單
    const { data: orders } = await axios.get(WC_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 50, order: "desc", orderby: "date" },
    });

    const orderLite = orders.find((o: any) =>
      o?.meta_data?.some((m: any) => m?.key === "newebpay_order_no" && m?.value === orderNo)
    );
    if (!orderLite) return res.status(404).json({ error: "找不到訂單" });

    // 2) 取詳情
    const { data: fullOrder } = await axios.get(`${WC_API_URL}/${orderLite.id}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    const meta: any[] = fullOrder?.meta_data || [];
    const lineItems: any[] = fullOrder?.line_items || [];

    // 取號/代碼資料（ATM/超商/WebATM）
    let offsiteInfo: any = null;
    const rawOffsite = meta.find((m) => m?.key === "newebpay_offsite_info")?.value;
    if (rawOffsite) {
      try { offsiteInfo = typeof rawOffsite === "string" ? JSON.parse(rawOffsite) : rawOffsite; } catch {}
    }

    const isPaid = computeIsPaid(fullOrder);
    const paymentStatusLabel = statusLabel(fullOrder);
    const paymentType =
      meta.find((m) => m?.key === "newebpay_payment_type")?.value ||
      fullOrder?.payment_method_title || "";

    const payTime =
      meta.find((m) => m?.key === "newebpay_pay_time")?.value ||
      fullOrder?.date_paid || "";

    const tradeNo =
      meta.find((m) => m?.key === "newebpay_trade_no")?.value ||
      fullOrder?.transaction_id || "";

    const orderInfo = {
      status: paymentStatusLabel,
      isPaid,
      MerchantOrderNo: orderNo,
      PaymentType: paymentType,
      PayTime: payTime,
      TradeNo: tradeNo,
      wooStatus: String(fullOrder?.status || ""),
    };

    // 先看整包 esim_qrcodes
    let qrcodes: QrcodeInfo[] = [];
    const multi = meta.find((m: any) => m?.key === "esim_qrcodes")?.value;
    if (multi) {
      try {
        const parsed = typeof multi === "string" ? JSON.parse(multi) : multi;
        if (Array.isArray(parsed)) {
          qrcodes = parsed
            .map((it: any, idx: number) => {
              const name = (it?.name && String(it.name).trim()) ? it.name : `eSIM #${idx + 1}`;
              const src = normalizeSrc(it?.src ?? it);
              return src ? { name, src } : null;
            })
            .filter(Boolean) as QrcodeInfo[];
        }
      } catch {}
    }

    // 舊欄位退回
    if (!qrcodes.length) {
      const single = meta.find((m: any) => m?.key === "esim_qrcode")?.value;
      const qtyStr = meta.find((m: any) => m?.key === "esim_quantity")?.value;
      const qty = Math.max(1, parseInt(String(qtyStr || "1"), 10));
      if (single) {
        const src = normalizeSrc(single);
        if (src) {
          qrcodes = Array.from({ length: qty }).map((_, i) => ({ name: `eSIM #${i + 1}`, src }));
        }
      }
    }

    // 再掃 line_items
    if (!qrcodes.length && Array.isArray(lineItems)) {
      const fromItems: QrcodeInfo[] = [];
      for (const li of lineItems) {
        const name = li?.name || "eSIM";
        const metaArr: any[] = li?.meta_data || [];
        const itemMulti = metaArr.find((m: any) => m?.key === "esim_qrcodes")?.value;
        const itemSingle = metaArr.find((m: any) => m?.key === "esim_qrcode")?.value;

        if (itemMulti) {
          try {
            const parsed = typeof itemMulti === "string" ? JSON.parse(itemMulti) : itemMulti;
            if (Array.isArray(parsed)) {
              parsed.forEach((raw: any, idx: number) => {
                const src = normalizeSrc(raw?.src ?? raw);
                if (src) fromItems.push({ name: `${name} #${idx + 1}`, src });
              });
            }
          } catch {}
        } else if (itemSingle) {
          const qty = Math.max(1, parseInt(String(li?.quantity || "1"), 10));
          const src = normalizeSrc(itemSingle);
          if (src) for (let i = 0; i < qty; i++) fromItems.push({ name: `${name} #${i + 1}`, src });
        }
      }
      if (fromItems.length) qrcodes = fromItems;
    }

    return res.status(200).json({
      orderInfo,
      offsiteInfo,
      offsitePending: !isPaid && !!offsiteInfo,
      qrcodes,
      message: qrcodes.length ? undefined : "尚未找到任何 eSIM QRCode，請稍後再試或聯繫客服。",
    });
  } catch (err: any) {
    console.error("❌ WooCommerce 查詢失敗:", err?.response?.data || err.message);
    return res.status(500).json({ error: "WooCommerce 查詢失敗", details: err?.response?.data || err.message });
  }
}
