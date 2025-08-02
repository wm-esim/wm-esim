import { NextApiRequest, NextApiResponse } from "next";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ success: false, message: "Email 格式錯誤" });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 碼驗證碼

  // 寫入記憶體（正式請改用 Redis、資料庫或 JWT）
  global.verificationCodes = global.verificationCodes || {};
  global.verificationCodes[email] = {
    code,
    expires: Date.now() + 10 * 60 * 1000, // 10 分鐘有效
  };

  // 寄信（用你的 Gmail 認證）
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "wandmesim@gmail.com",
      pass: "hwoywmluqvsuluss",
    },
  });

  await transporter.sendMail({
    from: `"eSIM 註冊驗證" <wandmesim@gmail.com>`,
    to: email,
    subject: "您的驗證碼",
    html: `<p>您的驗證碼是：<strong>${code}</strong></p><p>10 分鐘內有效</p>`,
  });

  return res.status(200).json({ success: true, message: "驗證碼已發送" });
}
