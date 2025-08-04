import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

// ✅ WooCommerce API 設定
const WC_API = "https://fegoesim.com/wp-json/wc/v3/coupons";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = (req.query.code || "").toString().trim();

  if (!code) {
    return res.status(400).json({ valid: false, message: "請提供優惠碼" });
  }

  try {
    const response = await axios.get(`${WC_API}?code=${encodeURIComponent(code)}`, {
      auth: {
        username: CONSUMER_KEY,
        password: CONSUMER_SECRET,
      },
    });

    const coupon = response.data?.[0];

    // ❌ 無此優惠碼或使用完畢
    if (!coupon) {
      return res.status(404).json({ valid: false, message: "優惠碼不存在" });
    }

    if (coupon.usage_limit > 0 && coupon.usage_count >= coupon.usage_limit) {
      return res.status(403).json({ valid: false, message: "優惠碼已使用完畢" });
    }

    // ❌ 僅允許固定金額折扣 fixed_cart（防止 percent 折扣誤用）
    if (coupon.discount_type !== "fixed_cart") {
      return res.status(400).json({ valid: false, message: "此優惠碼不支援此類折扣" });
    }

    // ✅ 成功：回傳優惠碼資訊
    return res.status(200).json({
      valid: true,
      code: coupon.code,
      amount: Number(coupon.amount),
      discount_type: coupon.discount_type,
      usage_count: coupon.usage_count,
      usage_limit: coupon.usage_limit,
    });
  } catch (err: any) {
    const message = err.response?.data || err.message || "未知錯誤";
    console.error("❌ 優惠碼查詢失敗:", message);
    return res.status(500).json({ valid: false, message: "伺服器錯誤，請稍後再試" });
  }
}
