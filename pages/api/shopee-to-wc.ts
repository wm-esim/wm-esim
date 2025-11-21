import type { NextApiRequest, NextApiResponse } from "next";
import axios, { AxiosError } from "axios";

// WooCommerce 設定
const WOOCOMMERCE_API_BASE = "https://fegoesim.com/wp-json/wc/v3";
const CONSUMER_KEY = "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const CONSUMER_SECRET = "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

function getSiteUrl(req: NextApiRequest) {
  // ✅ 優先用 env（正式站）
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;

  // ✅ fallback 用 request host（本機/preview）
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (req.headers.referer?.startsWith("http://") ? "http" : "https");
  const host = req.headers.host;
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    // Shopee payload 可能有不同 key，做兼容
    const body = req.body || {};
    const order_no = body.order_no || body.orderNo;
    const email = body.email;
    const items = body.items;
    const total_price = body.total_price || body.totalPrice;
    const orderIdRaw = body.order_id || body["order-id"] || body.orderId || "";

    if (!order_no || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "缺少必要欄位或 items 格式錯誤" });
    }

    // ✅ 檢查是否已存在同一 shopee 訂單編號
    const existingOrders = await axios.get(`${WOOCOMMERCE_API_BASE}/orders`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { per_page: 5, search: order_no },
    });

    const found = existingOrders.data.find((order: any) =>
      order.meta_data?.some(
        (meta: any) => meta.key === "shopee_order_no" && meta.value === order_no
      )
    );

    if (found) {
      return res.status(200).json({
        success: true,
        message: "訂單已存在",
        order_id: found.id,
      });
    }

    // ✅ 兌換 QRCode（每個 item 一次）
    const siteUrl = getSiteUrl(req);

    const redeemResults = await Promise.all(
      items.map(async (item: any) => {
        const sku = (item.sku || "").trim();
        const quantity = parseInt(item.quantity ?? "1", 10) || 1;

        if (!sku) {
          return {
            sku: "",
            ok: false,
            error: "Missing SKU",
          };
        }

        try {
          const qrcodeRes = await axios.post(
            `${siteUrl}/api/esim/qrcode`,
            {
              planId: sku,     // ✅ Shopee SKU -> planId
              number: quantity // ✅ items[].quantity -> number
            },
            { timeout: 20000 }
          );

          return {
            sku,
            ok: true,
            topup_id: qrcodeRes.data.topup_id,
            qrcode: qrcodeRes.data.qrcode,
          };
        } catch (e: any) {
          const upstream = e?.response?.data || e.message;
          return {
            sku,
            ok: false,
            error: upstream,
          };
        }
      })
    );

    const failedRedeems = redeemResults.filter(r => !r.ok);

    // ✅ 自行建立 line_items（不依賴 WooCommerce 商品）
    const line_items = items.map((item: any) => {
      const name = item.name || item.sku || "未命名商品";
      const sku =
        item.sku && item.sku.trim() !== ""
          ? item.sku
          : `CUSTOM-${name.slice(0, 10)}`;

      const price = parseFloat(item.price || "0");
      const quantity = parseInt(item.quantity || "1");

      // 找對應的兌換結果
      const redeem = redeemResults.find(r => r.sku === sku);

      return {
        name,
        sku,
        quantity,
        price: price.toFixed(2),
        total: (price * quantity).toFixed(2),

        // ✅ 把 qrcode/topup_id 記在 line_items meta
        meta_data: redeem?.ok
          ? [
              { key: "topup_id", value: redeem.topup_id },
              { key: "qrcode", value: Array.isArray(redeem.qrcode) ? redeem.qrcode.join(",") : String(redeem.qrcode) },
            ]
          : [
              { key: "redeem_error", value: JSON.stringify(redeem?.error || "Unknown redeem error") },
            ],
      };
    });

    const wooPayload = {
      payment_method: "shopee",
      payment_method_title: "蝦皮訂單",
      set_paid: true,
      billing: {
        first_name: order_no,
        email: email || "no@email.com",
        phone: "0000000000",
      },
      line_items,

      // ✅ 訂單層級 meta：包含 shopee info + 全部 redeem 結果
      meta_data: [
        { key: "shopee_order_no", value: order_no },
        { key: "shopee_order_id", value: orderIdRaw },
        { key: "source", value: "shopee" },
        { key: "total_price", value: total_price ?? "" },
        { key: "esim_redeem_results", value: JSON.stringify(redeemResults) },
        ...(failedRedeems.length
          ? [{ key: "esim_redeem_failed", value: JSON.stringify(failedRedeems) }]
          : []),
      ],
    };

    const wcRes = await axios.post(
      `${WOOCOMMERCE_API_BASE}/orders`,
      wooPayload,
      { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
    );

    return res.status(200).json({
      success: true,
      order_id: wcRes.data.id,
      redeem_results: redeemResults,
      warnings: failedRedeems.length ? failedRedeems : undefined,
    });
  } catch (err) {
    const error = err as AxiosError;
    const details = error.response?.data || error.message;
    console.error("❌ WooCommerce 訂單建立失敗：", details);
    return res.status(500).json({ error: "WooCommerce 訂單建立失敗", details });
  }
}
