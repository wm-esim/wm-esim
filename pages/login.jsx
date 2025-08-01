import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Layout from "./Layout";
import RegisterForm from "../components/RegisterForm";

const LoginRegisterPage = () => {
  const router = useRouter();
  const [selected, setSelected] = useState("login");
  const [form, setForm] = useState({ username: "", password: "" });
  const [token, setToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [message, setMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingEmail, setEditingEmail] = useState("");
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
      fetchUser(savedToken);
    }
  }, []);

  useEffect(() => {
    if (token && userInfo) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [token, userInfo]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setMessage("登入中...");
    try {
      const res = await fetch(
        "https://fegoesim.com/wp-json/jwt-auth/v1/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("token", data.token);
        setToken(data.token);
        fetchUser(data.token);
        setMessage("登入成功！");
      } else {
        setMessage(data.message || "登入失敗");
      }
    } catch (err) {
      setMessage("登入失敗: " + err.message);
    }
  };

  const fetchUser = async (jwt) => {
    try {
      const res = await fetch("https://fegoesim.com/wp-json/wp/v2/users/me", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await res.json();
      if (!data.code) {
        setUserInfo(data);
        localStorage.setItem("user", JSON.stringify(data));
        setEditingEmail(data.email || "");
      }
    } catch (err) {
      console.error("無法取得使用者資訊", err);
    }
  };

  const handleEmailUpdate = async () => {
    if (!editingEmail) {
      alert("請輸入 Email");
      return;
    }
    try {
      const res = await fetch(
        `https://fegoesim.com/wp-json/wp/v2/users/${userInfo.id}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: editingEmail }),
        }
      );
      const data = await res.json();
      if (!data.code) {
        setUserInfo(data);
        localStorage.setItem("user", JSON.stringify(data));
        setEditMode(false);
        setMessage("Email 更新成功");
      } else {
        alert(data.message || "更新失敗");
      }
    } catch (err) {
      console.error("更新 email 發生錯誤", err);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center px-3 min-h-screen pt-[100px]">
        <div className="w-full bg-[#f5f6f7] max-w-md border-gray-300 p-8 border rounded-xl shadow-lg">
          {!token ? (
            <div>
              <div className="flex justify-around mb-6">
                <button
                  onClick={() => setSelected("login")}
                  className={`px-4 py-2 rounded-full font-bold transition-all duration-200 ${
                    selected === "login"
                      ? "bg-[#1757FF] text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  登入
                </button>
                <button
                  onClick={() => setSelected("sign-up")}
                  className={`px-4 py-2 rounded-full font-bold transition-all duration-200 ${
                    selected === "sign-up"
                      ? "bg-[#1757FF] text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  註冊
                </button>
              </div>

              {/* 成功註冊提示 */}
              {selected === "login" && successMessage && (
                <div className="mb-4 p-2 text-center text-green-700 bg-green-100 rounded">
                  {successMessage}
                </div>
              )}

              {selected === "login" ? (
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <input
                    type="text"
                    name="username"
                    value={form.username}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        username: e.target.value,
                      }))
                    }
                    className="mt-1 block rounded-[13px] w-full border border-gray-300 p-2 focus:ring-2 focus:ring-gray-600 focus:outline-none"
                    required
                    placeholder="請輸入帳號"
                  />
                  <input
                    type="password"
                    name="password"
                    placeholder="請輸入密碼"
                    value={form.password}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        password: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full border border-gray-300 rounded-[13px] p-2 focus:ring-2 focus:ring-gray-600 focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    className="bg-[#1757FF] text-white py-2 rounded-[10px] hover:bg-[#2a3ebb] transition"
                  >
                    登入
                  </button>
                  {message && (
                    <p className="text-sm text-center text-red-500">
                      {message}
                    </p>
                  )}
                </form>
              ) : (
                <RegisterForm
                  onSuccess={(msg) => {
                    setSelected("login");
                    setSuccessMessage(msg);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="text-center space-y-4">
              <h2 className="text-xl font-bold">
                歡迎回來，{userInfo?.name || "會員"}
              </h2>
              <div className="text-sm text-gray-700">
                {editMode ? (
                  <div className="space-y-2">
                    <input
                      type="email"
                      value={editingEmail}
                      onChange={(e) => setEditingEmail(e.target.value)}
                      className="p-2 border border-gray-300 rounded-md w-full"
                      placeholder="請輸入 Email"
                    />
                    <div className="flex justify-center gap-4">
                      <button
                        onClick={handleEmailUpdate}
                        className="px-4 py-1 bg-green-600 text-white rounded"
                      >
                        儲存
                      </button>
                      <button
                        onClick={() => setEditMode(false)}
                        className="px-4 py-1 border text-gray-600 rounded"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p>
                      Email：
                      <span className="text-gray-900">
                        {userInfo?.email || "(未填寫)"}
                      </span>
                    </p>
                    <button
                      onClick={() => setEditMode(true)}
                      className="mt-2 text-sm text-blue-600 underline"
                    >
                      修改 Email
                    </button>
                  </div>
                )}
              </div>
              {message && <p className="text-sm text-center">{message}</p>}
              <span>等待跳轉至首頁，繼續購物</span>
            </div>
          )}
        </div>
        <div className="mt-10">
          <span className="text-[14px] text-gray-600">
            備註：請填入正確的 Email，此 Email 會拿來當作發送 QR CODE 兌換的依據
          </span>
        </div>
      </div>
    </Layout>
  );
};

export default LoginRegisterPage;
