import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import nodemailer from "nodemailer";

// ✅ 改成 env（你 env 裡已經有）
// WC
const WC_API_URL = process.env.WC_API_URL || "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = process.env.WC_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET!;

// Gmail
const GMAIL_USER = process.env.GMAIL_USER!;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!;

function getSiteUrl(req: NextApiRequest) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (req.headers.referer?.startsWith("http://") ? "http" : "https");
  const host = req.headers.host;
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

async function sendEsimEmail(to: string, orderNo: string, html: string) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `"汪喵通SIM" <${GMAIL_USER}>`,
    to,
    subject: `訂單 ${orderNo} 的 eSIM QRCode`,
    html,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { shopee_order_no, email } = req.body;
  if (!shopee_order_no) {
    return res.status(400).json({ error: "缺少 shopee_order_no" });
  }

  try {
    // ✅ 先用 search 縮小範圍（比抓 50 筆穩）
    const { data: orders } = await axios.get(WC_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: {
        per_page: 20,
        search: shopee_order_no,
        orderby: "date",
        order: "desc",
      },
    });

    const order = orders.find((o: any) =>
      o.meta_data?.some((m: any) =>
        m.key === "shopee_order_no" &&
        typeof m.value === "string" &&
        m.value.trim().toUpperCase() === shopee_order_no.trim().toUpperCase()
      )
    );

    if (!order) return res.status(404).json({ error: "找不到該訂單" });

    const orderId = order.id;

    const { data: fullOrder } = await axios.get(`${WC_API_URL}/${orderId}`, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    });

    const alreadyRedeemed = fullOrder.meta_data?.some(
      (m: any) => m.key === "esim_qrcode_redeemed" && m.value === "yes"
    );

    if (alreadyRedeemed) {
      return res.status(200).json({
        success: false,
        message: "此訂單已完成兌換，請勿重複提交。",
        alreadyRedeemed: true,
      });
    }

    const customerEmail = email || fullOrder.billing?.email || "";
    if (!customerEmail) return res.status(400).json({ error: "無法取得 email" });

    const lineItems = fullOrder.line_items || [];
    if (!lineItems.length) {
      return res.status(400).json({ error: "訂單沒有 line_items" });
    }

    const siteUrl = getSiteUrl(req);
    const ESIM_PROXY_URL = `${siteUrl}/api/esim/qrcode`;

    const htmlList: string[] = [];
    const metaToAppend: any[] = []; // ✅ 統一累積 meta，最後一次寫入
    const redeemErrors: any[] = [];

    for (const item of lineItems) {
      const sku = (item.sku || "").trim();
      const displayName = item.name || sku || "未命名商品";
      const quantity = item.quantity || 1;

      if (!sku) {
        redeemErrors.push({ sku: "", error: "line_item 缺少 sku" });
        continue;
      }

      // ✅ 若之前部分成功過（有 meta），就跳過避免重複發卡
      const alreadyHasQr = fullOrder.meta_data?.some(
        (m: any) => m.key === `esim_qrcode_${sku}` && m.value
      );

      if (alreadyHasQr) {
        htmlList.push(`<p><strong>${displayName}</strong>：此 SKU 已有 QRCode，跳過重複兌換。</p>`);
        continue;
      }

      try {
        // ✅ 送 planId=sku，讓 qrcode.ts 自己走 Supabase mapping
        const { data: esim } = await axios.post(
          ESIM_PROXY_URL,
          { planId: sku, number: quantity },
          { timeout: 20000 }
        );

        const imageList: string[] = Array.isArray(esim.qrcode)
          ? esim.qrcode.map(String)
          : [String(esim.qrcode)];

        const qrcodeHtmlList = imageList.map((src, idx) => {
          const imgTag = src.startsWith("http")
            ? `<img src="${src}" style="max-width:300px" />`
            : `<img src="data:image/png;base64,${src}" style="max-width:300px" />`;
          return `<p><strong>${displayName} - 第 ${idx + 1} 張</strong></p>${imgTag}`;
        });

        htmlList.push(qrcodeHtmlList.join("<br/>"));

        // ✅ 累積 meta（最後一起寫）
        metaToAppend.push(
          { key: `esim_plan_sku_${sku}`, value: sku },
          { key: `esim_topup_id_${sku}`, value: String(esim.topup_id || "") },
          { key: `esim_qrcode_${sku}`, value: imageList.join(",") }
        );

        // ✅ 寫入訂單備註（顯示 QRCode）
        await axios.post(
          `${WC_API_URL}/${orderId}/notes`,
          {
            note: qrcodeHtmlList.join("<br/>"),
            customer_note: true,
          },
          { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
        );
      } catch (e: any) {
        const upstream = e?.response?.data || e.message;
        redeemErrors.push({ sku, error: upstream });

        htmlList.push(
          `<p><strong>${displayName}</strong> 兌換失敗：${JSON.stringify(upstream)}</p>`
        );
      }
    }

    // ✅ 先把成功/失敗紀錄寫回訂單（一次 PUT）
    if (metaToAppend.length || redeemErrors.length) {
      const metaAll = [
        ...(fullOrder.meta_data || []),
        ...metaToAppend,
        ...(redeemErrors.length
          ? [{ key: "esim_redeem_failed", value: JSON.stringify(redeemErrors) }]
          : []),
      ];

      await axios.put(
        `${WC_API_URL}/${orderId}`,
        { meta_data: metaAll },
        { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
      );
    }

    // ✅ 寄信（包含成功+失敗的 html）
    await sendEsimEmail(customerEmail, shopee_order_no, htmlList.join("<hr/>"));

    // ✅ 若全部成功才標 redeemed + completed
    if (redeemErrors.length === 0) {
      await axios.put(
        `${WC_API_URL}/${orderId}`,
        {
          status: "completed",
          meta_data: [
            ...(fullOrder.meta_data || []),
            { key: "esim_qrcode_redeemed", value: "yes" },
          ],
        },
        { auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET } }
      );
    }

    return res.status(200).json({
      success: redeemErrors.length === 0,
      message:
        redeemErrors.length === 0
          ? "已處理並寄送 QRCode，訂單已完成"
          : "部分 SKU 兌換失敗，已寄送成功項目並寫入失敗原因",
      redeemErrors: redeemErrors.length ? redeemErrors : undefined,
    });
  } catch (err: any) {
    console.error("❌ 發生錯誤：", err?.response?.data || err.message);
    return res.status(500).json({ error: "系統錯誤", detail: err?.response?.data || err.message });
  }
}
