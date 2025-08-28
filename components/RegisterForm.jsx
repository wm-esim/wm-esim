import { useState, useEffect } from "react";

const RESEND_WAIT_SECONDS = 60; // 幾秒後才顯示「沒收到？重新寄送」

const RegisterForm = ({ onSuccess }) => {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    code: "",
  });

  const [message, setMessage] = useState("");
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [isCodeVerified, setIsCodeVerified] = useState(false);

  // 防止連點與倒數
  const [cooldown, setCooldown] = useState(0); // 發送按鈕冷卻（10s）
  const [resendWait, setResendWait] = useState(0); // 顯示「重新寄送」前的等待（60s）
  const [sending, setSending] = useState(false); // 正在送出「寄送驗證碼」
  const [verifying, setVerifying] = useState(false); // 正在驗證中
  const [registering, setRegistering] = useState(false); // 正在註冊中

  useEffect(() => {
    let t;
    if (cooldown > 0) t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    let t;
    if (resendWait > 0) t = setTimeout(() => setResendWait((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendWait]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // 共用：呼叫 /api/send-code
  const sendCode = async (action = "new") => {
    if (sending || cooldown > 0) return;
    if (!form.email) return setMessage("請先輸入 Email");

    setSending(true);
    setMessage("");
    try {
      const res = await fetch("/api/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, action }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setMessage(
          action === "resend"
            ? "已重新寄送驗證碼，請查收 Email"
            : "驗證碼已寄出，請查收 Email"
        );
        setIsCodeSent(true);
        setIsCodeVerified(false); // 重新寄送後一定要重驗
        setForm((prev) => ({ ...prev, code: "" })); // 清空輸入框
        setCooldown(data.cooldown ?? 10); // 伺服器回的冷卻秒數（預設 10）
        setResendWait(RESEND_WAIT_SECONDS); // 再等一段時間才顯示「重新寄送」
      } else {
        setMessage(data.message || "驗證碼寄送失敗");
      }
    } catch (err) {
      setMessage("錯誤：" + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleSendCode = () => sendCode("new");
  const handleResend = () => sendCode("resend");

  const handleVerifyCode = async () => {
    if (verifying) return;
    if (!form.email || !form.code) {
      return setMessage("請輸入 Email 與驗證碼");
    }

    setVerifying(true);
    setMessage("");
    try {
      const res = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, code: form.code }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessage("✅ 驗證成功，請繼續註冊");
        setIsCodeVerified(true);
      } else {
        setMessage(data.message || "驗證碼錯誤或已過期");
      }
    } catch (err) {
      setMessage("錯誤：" + err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (registering) return;
    if (!isCodeVerified) return setMessage("請先完成 Email 驗證");

    setRegistering(true);
    setMessage("註冊中...");
    try {
      const res = await fetch(
        "https://fegoesim.com/wp-json/custom/v1/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: form.username,
            email: form.email,
            password: form.password,
          }),
        }
      );

      const data = await res.json();
      if (res.ok && data.user_id) {
        setShowSuccessPopup(true);
        setMessage("");
        onSuccess?.("註冊成功！請登入會員");
        setTimeout(() => setShowSuccessPopup(false), 3000);
      } else {
        setMessage(data.message || "註冊失敗");
      }
    } catch (err) {
      setMessage("錯誤：" + err.message);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="relative">
      {showSuccessPopup && (
        <div className="absolute top-[-50px] left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50">
          註冊成功！
        </div>
      )}

      <form onSubmit={handleRegister} className="flex flex-col gap-4">
        <input
          required
          type="text"
          name="username"
          value={form.username}
          onChange={handleChange}
          className="w-full px-4 py-2 border border-gray-300 rounded-[13px]"
          placeholder="請輸入帳號"
        />

        <div className="flex gap-2">
          <input
            required
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-[13px]"
            placeholder="請輸入 Email"
          />
          <button
            type="button"
            onClick={handleSendCode}
            disabled={sending || cooldown > 0}
            className={`px-4 py-2 rounded-[10px] text-white ${
              sending || cooldown > 0
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {sending
              ? "寄送中..."
              : cooldown > 0
              ? `請稍候 ${cooldown}s`
              : "發送驗證碼"}
          </button>
        </div>

        {isCodeSent && (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                name="code"
                value={form.code}
                onChange={handleChange}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-[13px]"
                placeholder="請輸入驗證碼"
              />
              <button
                type="button"
                onClick={handleVerifyCode}
                disabled={verifying}
                className={`px-4 py-2 rounded-[10px] text-white ${
                  verifying
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {verifying ? "驗證中..." : "驗證"}
              </button>
            </div>

            {/* 沒收到驗證碼？重新寄送 */}
            <div className="text-sm text-gray-600">
              {resendWait > 0 ? (
                <span>若未收到，可於 {resendWait}s 後重新寄送</span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={sending || cooldown > 0}
                  className="underline underline-offset-2 hover:text-blue-700 disabled:text-gray-400"
                >
                  沒收到驗證碼？重新寄送
                </button>
              )}
            </div>
          </>
        )}

        <input
          required
          type="password"
          name="password"
          value={form.password}
          onChange={handleChange}
          className="w-full px-4 py-2 border border-gray-300 rounded-[13px]"
          placeholder="請輸入密碼"
        />

        <button
          type="submit"
          disabled={registering}
          className={`text-white py-2 rounded-[10px] transition ${
            registering
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-[#1757FF] hover:bg-[#2a3ebb]"
          }`}
        >
          {registering ? "註冊中..." : "註冊"}
        </button>
      </form>

      {message && (
        <p className="text-sm text-center text-red-600 mt-2">{message}</p>
      )}
    </div>
  );
};

export default RegisterForm;
