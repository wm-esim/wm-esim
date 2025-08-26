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

// 決定是否為已付款（依 Woo 狀態 + 你在 notify 寫入的資訊）
function computeIsPaid(order: any): boolean {
  // Woo 常見已付狀態：processing / completed
  const s = String(order?.status || "").toLowerCase();
  if (s === "processing" || s === "completed") return true;

  // 如果有 date_paid 也視為已付
  if (order?.date_paid) return true;

  // meta 若有你在 notify 時寫入的 pay time 也可視為已付
  const meta: any[] = order?.meta_data || [];
  const payTime = meta.find((m) => m?.key === "newebpay_pay_time")?.value;
  if (payTime) return true;

  return false;
}

// 將 Woo 狀態轉成前端友善字串（可自行調整）
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

  // 簡單清理（避免特殊字元干擾）
  orderNo = orderNo.replace(/[&/\\]/g, "-");

  try {
    // 1) 先用列表查出該筆訂單（用我們自訂 meta：newebpay_order_no）
    const { data: orders } = await axios.get(WC_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 20, order: "desc", orderby: "date" },
    });

    const orderLite = orders.find((o: any) =>
      o?.meta_data?.some(
        (m: any) => m?.key === "newebpay_order_no" && m?.value === orderNo
      )
    );

    if (!orderLite) {
      return res.status(404).json({ error: "找不到訂單" });
    }

    // 2) 取單筆詳情（為了拿齊 meta 與 line_items）
    const { data: fullOrder } = await axios.get(`${WC_API_URL}/${orderLite.id}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    const meta: any[] = fullOrder?.meta_data || [];
    const lineItems: any[] = fullOrder?.line_items || [];

    // === 讀取藍新匯款/代碼資訊（在 notify/return 時寫入的 meta）===
    let offsiteInfo: any = null;
    const rawOffsite = meta.find((m) => m?.key === "newebpay_offsite_info")?.value;
    if (rawOffsite) {
      try {
        offsiteInfo = typeof rawOffsite === "string" ? JSON.parse(rawOffsite) : rawOffsite;
      } catch {
        // 舊資料若是 querystring 或格式不正，這裡可再做容錯解析（目前略過）
      }
    }

    // === 計算付款狀態 ===
    const isPaid = computeIsPaid(fullOrder);
    const paymentStatusLabel = statusLabel(fullOrder);

    // 3) 組 orderInfo（維持你原本欄位 + 新增可讀性欄位）
    const orderInfo = {
      status: paymentStatusLabel,                          // e.g. SUCCESS / PENDING / FAILED...
      isPaid,                                              // boolean
      MerchantOrderNo: orderNo,
      PaymentType:
        meta.find((m) => m?.key === "newebpay_payment_type")?.value ||
        fullOrder?.payment_method_title ||
        "",
      PayTime:
        meta.find((m) => m?.key === "newebpay_pay_time")?.value ||
        fullOrder?.date_paid ||
        "",
      TradeNo:
        meta.find((m) => m?.key === "newebpay_trade_no")?.value ||
        fullOrder?.transaction_id ||
        "",
    };

    // 4) 先嘗試讀「整包」 esim_qrcodes（建議的存法）
    let qrcodes: QrcodeInfo[] = [];
    const multi = meta.find((m: any) => m?.key === "esim_qrcodes")?.value;

    if (multi) {
      try {
        const parsed = typeof multi === "string" ? JSON.parse(multi) : multi;
        if (Array.isArray(parsed)) {
          qrcodes = parsed
            .map((it: any, idx: number) => {
              const name =
                typeof it?.name === "string" && it.name.trim()
                  ? it.name
                  : `eSIM #${idx + 1}`;
              const src = normalizeSrc(it?.src);
              return src ? { name, src } : null;
            })
            .filter(Boolean) as QrcodeInfo[];
        }
      } catch {
        // 忽略解析錯誤，往下用備援方案
      }
    }

    // 5) 若沒有整包資料，再試舊邏輯：單一 esim_qrcode + esim_quantity
    if (!qrcodes.length) {
      const single = meta.find((m: any) => m?.key === "esim_qrcode")?.value;
      const qtyStr = meta.find((m: any) => m?.key === "esim_quantity")?.value;
      const qty = Math.max(1, parseInt(String(qtyStr || "1"), 10));

      if (single) {
        const src = normalizeSrc(single);
        if (src) {
          qrcodes = Array.from({ length: qty }).map((_, i) => ({
            name: `eSIM #${i + 1}`,
            src,
          }));
        }
      }
    }

    // 6) 再下一層備援：掃 line_items（若未來你把 QR 寫進每個品項 meta）
    if (!qrcodes.length && Array.isArray(lineItems)) {
      const fromItems: QrcodeInfo[] = [];
      for (const li of lineItems) {
        const name = li?.name || "eSIM";
        const metaArr: any[] = li?.meta_data || [];

        // a) 每個 item 一個 esim_qrcode + item 的 quantity
        // b) 每個 item 有一個 esim_qrcodes（陣列或 JSON 字串），逐一展開
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
          } catch {
            // ignore
          }
        } else if (itemSingle) {
          const qty = Math.max(1, parseInt(String(li?.quantity || "1"), 10));
          const src = normalizeSrc(itemSingle);
          if (src) {
            for (let i = 0; i < qty; i++) {
              fromItems.push({ name: `${name} #${i + 1}`, src });
            }
          }
        }
      }

      if (fromItems.length) qrcodes = fromItems;
    }

    // 7) 最終回傳：把 offsiteInfo 一起帶給前端（若存在且未付款，就能展示匯款資訊）
    return res.status(200).json({
      orderInfo,
      offsiteInfo, // 👈 ATM/超商等待繳資訊（可能包含 BankCode/CodeNo/PaymentNo/ExpireDate…）
      qrcodes,
      message:
        qrcodes.length === 0
          ? "尚未找到任何 eSIM QRCode，請稍後再試或聯繫客服。"
          : undefined,
    });
  } catch (err: any) {
    console.error("❌ WooCommerce 查詢失敗:", err?.response?.data || err.message);
    return res.status(500).json({
      error: "WooCommerce 查詢失敗",
      details: err?.response?.data || err.message,
    });
  }
}
