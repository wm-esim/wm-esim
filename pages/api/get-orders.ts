// /pages/api/get-orders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const WC_API_URL = "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = process.env.NEXT_PUBLIC_WC_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.NEXT_PUBLIC_WC_CONSUMER_SECRET!;

function pickOffsiteInfo(meta: any[]): any | null {
  if (!Array.isArray(meta)) return null;
  const raw = meta.find((m) => m?.key === "newebpay_offsite_info")?.value;
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = req.query;

  if (!userId) return res.status(400).json({ error: "缺少 userId" });

  try {
    // 1) 抓清單（精簡）
    const { data: list } = await axios.get(WC_API_URL, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: {
        customer: userId,
        per_page: 50,
        status: "any",
        orderby: "date",
        order: "desc",
      },
    });

    console.log("✅ WooCommerce 訂單清單（精簡）筆數：", Array.isArray(list) ? list.length : 0);

    // 2) 逐筆抓詳情（完整 meta_data）
    const detailPromises = (Array.isArray(list) ? list : []).map((o: any) =>
      axios
        .get(`${WC_API_URL}/${o.id}`, {
          auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
        })
        .then(({ data }) => data)
        .catch((e) => {
          console.warn("⚠️ 讀取訂單詳情失敗：", o.id, e?.response?.status || e.message);
          return o; // 退回精簡版，至少不會整筆消失
        })
    );

    const details = await Promise.all(detailPromises);

    // 3) 加工：補上 offsiteInfo 方便前端直接使用
    const enriched = details.map((ord: any) => {
      const offsiteInfo = pickOffsiteInfo(ord?.meta_data || []);
      const paymentType =
        (ord?.meta_data || []).find((m: any) => m?.key === "newebpay_payment_type")?.value ||
        ord?.payment_method_title ||
        "";

      return {
        ...ord,
        offsiteInfo,
        paymentType,
      };
    });

    // 診斷輸出一下哪些訂單有 offsiteInfo、狀態如何
    enriched.forEach((o: any) => {
      const hasOff = !!o.offsiteInfo;
      console.log(
        `#${o.id} | 狀態:${o.status} | customer_id:${o.customer_id} | offsite:${hasOff ? "Y" : "N"}`
      );
    });

    res.status(200).json(enriched);
  } catch (error: any) {
    console.error("❌ WooCommerce 訂單查詢錯誤:", error?.response?.data || error.message);
    res.status(500).json({ error: "訂單查詢失敗", detail: error?.message });
  }
}
