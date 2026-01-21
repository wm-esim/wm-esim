import type { NextApiRequest, NextApiResponse } from "next";
import nodemailer from "nodemailer";

// 請確保這與您的 WP 實際網址一致
const WP_BASE = "https://fegoesim.com";

// 前端網址 (請確認本地測試是 localhost，上線是 wmesim.com)
const APP_ORIGIN = process.env.APP_ORIGIN || "https://www.wmesim.com";

const GMAIL_USER = process.env.GMAIL_USER || "wandmesim@gmail.com";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "hwoywmluqvsuluss";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });

  try {
    const { identifier } = req.body || {};
    if (!identifier || typeof identifier !== "string") {
      return res.status(400).json({ ok: false, message: "缺少 identifier (帳號或 Email)" });
    }

    // 1. 修改點：呼叫正確的 API 路徑 "/retrieve_password"
    const wpResp = await fetch(`${WP_BASE}/wp-json/custom/v1/retrieve_password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });

    const data = await wpResp.json().catch(() => ({} as any));

    // 如果 WP 找不到人，這裡會收到 error，但為了資安通常我們還是會回傳 "已寄出"
    if (!wpResp.ok || !data.success) {
      console.warn("WP API lookup failed:", data); // 保留 log 方便除錯
      return res.status(200).json({ ok: true, message: "若該 Email/帳號存在，將寄出重設密碼信。" });
    }

    // 2. 修改點：直接讀取新 API 回傳的欄位 (key, user_email, user_login)
    const { key, user_email, user_login } = data;

    // 3. 組成重設連結 (直接使用 key，不需要再去 parse URL)
    // 連結格式範例: https://www.wmesim.com/reset-password?key=xyz&login=abc
    const appResetUrl = `${APP_ORIGIN.replace(/\/$/, "")}/reset-password?key=${encodeURIComponent(
      key
    )}&login=${encodeURIComponent(user_login)}`;

    if (user_email && key && user_login) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      });

      await transporter.sendMail({
        from: `eSIM 團隊 <${GMAIL_USER}>`,
        to: user_email, // 寄給從 WP 查到的 email
        subject: `【汪喵通 eSIM】重設您的密碼`,
        html: `
          <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.6; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #333;">密碼重設請求</h2>
            <p>您好，我們收到帳號 <strong>${user_login}</strong> 的密碼重設請求。</p>
            <p>請點擊以下按鈕設定新密碼（連結 30 分鐘內有效）：</p>
            <p style="margin: 25px 0;">
              <a href="${appResetUrl}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#1757FF;color:#fff;text-decoration:none;font-weight:bold;">
                前往重設密碼
              </a>
            </p>
            <p style="color: #666; font-size: 0.9em;">
              或者您可以複製以下連結至瀏覽器開啟：<br/>
              ${appResetUrl}
            </p>
            <hr style="border:none; border-top:1px solid #eee; margin: 20px 0;" />
            <p style="color: #999; font-size: 0.8em;">若非您本人操作，請忽略此信，您的帳號仍然安全。</p>
          </div>
        `,
      });
    }

    return res.status(200).json({ ok: true, message: "若該 Email/帳號存在，將寄出重設密碼信。" });

  } catch (err: any) {
    console.error("forgot-password api error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, message: "系統忙線，請稍後再試" });
  }
}