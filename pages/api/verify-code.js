export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ success: false, message: "缺少參數" });
  }

  global.verificationCodes = global.verificationCodes || {};
  const record = global.verificationCodes[email];

  if (!record) {
    return res.status(400).json({ success: false, message: "尚未發送驗證碼" });
  }

  if (Date.now() > record.expires) {
    return res.status(400).json({ success: false, message: "驗證碼已過期" });
  }

  if (record.code !== code) {
    return res.status(400).json({ success: false, message: "驗證碼錯誤" });
  }

  // 驗證成功：可以設全域或 token 等後續處理
  delete global.verificationCodes[email]; // 一次性

  return res.status(200).json({ success: true, verified: true });
}
