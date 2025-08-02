import { useState, useEffect } from "react";

const RegisterForm = ({ onSuccess }) => {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
  });
  const [message, setMessage] = useState("");
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setMessage("註冊中...");

    try {
      const res = await fetch(
        "https://fegoesim.com/wp-json/custom/v1/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );

      const data = await res.json();
      if (res.ok && data.user_id) {
        setIsRegistered(true);
        setMessage("");
        setShowSuccessPopup(true);
        if (onSuccess) onSuccess("註冊成功！請登入會員");

        setTimeout(() => {
          setShowSuccessPopup(false);
        }, 3000);
      } else {
        setMessage(data.message || "註冊失敗");
      }
    } catch (err) {
      setMessage("錯誤：" + err.message);
    }
  };

  return (
    <div className="relative">
      {/* ✅ 彈出式成功提示 */}
      {showSuccessPopup && (
        <div className="absolute top-[-50px] left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50">
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
          className="w-full px-4 py-2 border border-gray-300 rounded-[13px] focus:outline-none focus:ring-2 focus:ring-black/50"
          placeholder="請輸入帳號"
        />
        <input
          required
          type="email"
          name="email"
          value={form.email}
          onChange={handleChange}
          className="w-full px-4 py-2 border border-gray-300 rounded-[13px] focus:outline-none focus:ring-2 focus:ring-black/50"
          placeholder="請輸入 Email"
        />
        <input
          required
          type="password"
          name="password"
          value={form.password}
          onChange={handleChange}
          className="w-full px-4 py-2 border border-gray-300 rounded-[13px] focus:outline-none focus:ring-2 focus:ring-black/50"
          placeholder="請輸入密碼"
        />
        <button
          type="submit"
          className="bg-[#1757FF] text-white py-2 rounded-[10px] hover:bg-[#2a3ebb] transition"
        >
          註冊
        </button>
      </form>

      {/* ✅ 錯誤訊息 */}
      {message && (
        <p className="text-sm text-center text-red-600 mt-2">{message}</p>
      )}

      {/* ✅ 成功訊息顯示 */}
      {isRegistered && (
        <p className="text-sm text-center text-green-600 mt-4">
          已成功註冊會員，請登入會員
        </p>
      )}
    </div>
  );
};

export default RegisterForm;
