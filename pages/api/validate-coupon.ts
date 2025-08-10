import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

// ✅ WooCommerce API 設定
const WC_API = "https://fegoesim.com/wp-json/wc/v3/coupons";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

// 四捨五入到整數（half up）
const roundHalfUp = (n: number) => (n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5));
// 元 ➜ 分（整數）
const toCents = (amount: any) => roundHalfUp(parseFloat(String(amount || 0)) * 100);
// 分 ➜ 元（整數，顯示用）
const fromCents = (cents: number) => roundHalfUp(cents / 100);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = (req.query.code || "").toString().trim();
  const subtotalRaw = req.query.subtotal; // 選填：元
  const hasSubtotal = subtotalRaw !== undefined;
  const subtotalCents = hasSubtotal ? toCents(subtotalRaw) : undefined;

  if (!code) {
    return res.status(400).json({ valid: false, message: "請提供優惠碼" });
  }
  if (hasSubtotal && (isNaN(Number(subtotalRaw)) || Number(subtotalRaw) < 0)) {
    return res.status(400).json({ valid: false, message: "subtotal 需為非負數字" });
  }

  try {
    const { data } = await axios.get(WC_API, {
      auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
      params: { code: encodeURIComponent(code) },
    });

    const coupon = Array.isArray(data) ? data[0] : null;

    // ❌ 無此優惠碼或使用完畢
    if (!coupon) {
      return res.status(404).json({ valid: false, message: "優惠碼不存在" });
    }
    if (coupon.usage_limit > 0 && coupon.usage_count >= coupon.usage_limit) {
      return res.status(403).json({ valid: false, message: "優惠碼已使用完畢" });
    }

    // ✅ 支援 fixed_cart 與 percent
    const discountType: string = coupon.discount_type; // "fixed_cart" | "percent" | ...
    const amountNum = parseFloat(coupon.amount || "0"); // fixed_cart: 元數；percent: 百分比數值
    const amountCents = discountType === "fixed_cart" ? toCents(amountNum) : null;

    if (discountType !== "fixed_cart" && discountType !== "percent") {
      return res.status(400).json({ valid: false, message: `不支援的折扣類型：${discountType}` });
    }

    // ➜ 若帶 subtotal，計算實際折抵（以分為單位，整數）
    let discountCents: number | null = null;
    if (hasSubtotal && typeof subtotalCents === "number") {
      if (discountType === "fixed_cart") {
        // 固定金額折抵，不得超過小計
        discountCents = Math.max(0, Math.min(amountCents as number, subtotalCents));
      } else {
        // 百分比折抵：subtotalCents * (pct/100)，四捨五入到分
        const pct = Math.min(Math.max(amountNum, 0), 100);
        discountCents = roundHalfUp(subtotalCents * (pct / 100));
      }
    }

    // ✅ 成功：維持你原欄位，並加上 *_cents 供發票/後端用
    return res.status(200).json({
      valid: true,
      code: coupon.code,                 // Woo 通常回小寫
      amount: amountNum,                 // fixed_cart: 元；percent: 百分比
      discount_type: discountType,       // 原 Woo 類型
      usage_count: coupon.usage_count,
      usage_limit: coupon.usage_limit,
      // 新增（不影響原前端）：
      type: discountType === "percent" ? "percent" : "fixed",
      discount: discountCents !== null ? fromCents(discountCents) : null, // 顯示用整數元
      // 🔒 精準欄位（整數「分」）：請在開立發票 & 最終金額計算時使用
      amount_cents: amountCents,         // 僅 fixed_cart 有值
      discount_cents: discountCents,     // 若帶 subtotal 才有值
      subtotal_cents: hasSubtotal ? subtotalCents : null,
    });
  } catch (err: any) {
    const message = err.response?.data || err.message || "未知錯誤";
    console.error("❌ 優惠碼查詢失敗:", message);
    return res.status(500).json({ valid: false, message: "伺服器錯誤，請稍後再試" });
  }
}
