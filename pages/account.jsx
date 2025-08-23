"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import Layout from "./Layout";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

/** 將任意金額字串/數字 → 四捨五入為整數並加上千分位 */
const formatNTDNoDecimals = (val) => {
  if (val == null) return "0";
  // 允許傳入 "27.20"、"NT$27.20" 等；只保留數字與正負號與小數點
  const n = Number(String(val).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n); // 四捨五入
  return rounded.toLocaleString("zh-TW"); // 千分位
};

const AccountPage = () => {
  const [userInfo, setUserInfo] = useState(null);
  const [orders, setOrders] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState("info");
  const [editingEmail, setEditingEmail] = useState("");
  const [editingPhone, setEditingPhone] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }

    fetch("https://fegoesim.com/wp-json/wp/v2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((user) => {
        setUserInfo(user);
        setEditingEmail(user.email || "");
        setEditingPhone(user.meta?.billing_phone || "");
        setEditingName(user.name || "");
        localStorage.setItem("user", JSON.stringify(user));
        return fetch(`/api/get-orders?userId=${user.id}`);
      })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOrders(data);
        } else {
          console.warn("⚠️ 訂單格式錯誤", data);
          setOrders([]);
        }
      })
      .catch(() => router.push("/login"));

    const storedFavorites = JSON.parse(
      localStorage.getItem("favorites") || "[]"
    );
    setFavorites(storedFavorites);
  }, []);

  const handleProfileUpdate = async () => {
    const token = localStorage.getItem("token");
    if (!token || !userInfo?.id) return;

    try {
      const res = await fetch(
        `https://fegoesim.com/wp-json/wp/v2/users/${userInfo.id}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editingName,
            email: editingEmail,
            meta: { billing_phone: editingPhone },
          }),
        }
      );
      const data = await res.json();
      if (!data.code) {
        setUserInfo(data);
        setEditMode(false);
        localStorage.setItem("user", JSON.stringify(data));
        alert("會員資料更新成功");
      } else {
        alert(data.message || "更新失敗");
      }
    } catch (err) {
      console.error("更新會員資料時發生錯誤", err);
    }
  };

  if (!userInfo)
    return <p className="mt-40 text-center">正在載入會員資料...</p>;

  return (
    <Layout>
      <div className=" bg-[#f7f8f9] flex flex-col justify-center items-center">
        <div className="w-full py-20">
          <div className="dashdoard   max-w-[1920px] w-[95%] xl:w-[85%] mx-auto py-8 2xl:py-20">
            <div className="navgation flex max-w-[1920px]  w-[80%] mb-8">
              <Link href="/" className="group">
                <span className="text-slate-500 text-[16px] group-hover:text-[#1757FF] group-hover:font-bold duration-300">
                  回首頁
                </span>
              </Link>
              <span className="mx-3">/</span>
              <Link href="/account">
                <span className="font-bold text-[#1757FF] text-[16px]">
                  會員資訊
                </span>
              </Link>
            </div>
            <div className="titile">
              <h1 className="text-[28px]">會員中心</h1>
            </div>

            <div className="wrap flex flex-col lg:flex-row mt-10 gap-10">
              <div className="tabs w-full lg:w-[20%] pr-6">
                <ul className="flex flex-col gap-4">
                  <li>
                    <button
                      onClick={() => setActiveTab("info")}
                      className={`block w-full text-left rounded-[5px] px-4 py-2 ${
                        activeTab === "info"
                          ? "bg-[#1757FF] text-white font-bold"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      會員資料
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => setActiveTab("qrcode")}
                      className={`block w-full text-left px-4 py-2 rounded-[5px] ${
                        activeTab === "qrcode"
                          ? "bg-[#1757FF] text-white font-bold"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      QR Code 訂單
                    </button>
                  </li>
                </ul>
              </div>

              <div className="info w-full lg:w-[80%] relative mb-10 min-h-[600px]">
                <AnimatePresence mode="wait">
                  {activeTab === "info" && (
                    <motion.div
                      key="info"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      className="w-full bg-white rounded-[6px] p-8"
                    >
                      <h1 className="text-2xl font-bold mb-4">會員資料</h1>
                      {editMode ? (
                        <div className="space-y-4">
                          <input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            placeholder="姓名"
                            className="p-2 border rounded w-full"
                          />
                          <input
                            value={editingEmail}
                            onChange={(e) => setEditingEmail(e.target.value)}
                            placeholder="Email"
                            className="p-2 border rounded w-full"
                          />
                          <input
                            value={editingPhone}
                            onChange={(e) => setEditingPhone(e.target.value)}
                            placeholder="電話"
                            className="p-2 border rounded w-full"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleProfileUpdate}
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
                        <div className="mt-1 space-y-2">
                          <p>姓名：{userInfo.name}</p>
                          <p>
                            Email：
                            {userInfo.email || (
                              <span className="text-gray-400">(未填寫)</span>
                            )}
                          </p>
                          <p>
                            電話：
                            {userInfo.meta?.billing_phone || (
                              <span className="text-gray-400">(未填寫)</span>
                            )}
                          </p>
                          <button
                            onClick={() => setEditMode(true)}
                            className="mt-1 text-sm text-blue-600 underline"
                          >
                            修改會員資料
                          </button>
                        </div>
                      )}

                      <h2 className="text-xl font-semibold mt-8 mb-2">
                        我的最愛
                      </h2>
                      {favorites.length === 0 ? (
                        <p>尚未加入任何商品至我的最愛。</p>
                      ) : (
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {favorites.map((item) => (
                            <li
                              key={item.id}
                              className="flex items-center gap-4 p-4 rounded shadow-sm"
                            >
                              <Image
                                src={item.image || "/images/default.jpg"}
                                alt={item.name}
                                width={80}
                                height={80}
                                className="rounded"
                              />
                              <p className="text-sm font-medium">{item.name}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </motion.div>
                  )}

                  {activeTab === "qrcode" && (
                    <motion.div
                      key="qrcode"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      className=" top-0 left-0 w-full bg-white rounded-[6px] p-4 sm:p-8"
                    >
                      <h2 className="text-2xl font-semibold mb-4">我的訂單</h2>
                      {orders.length === 0 ? (
                        <p>尚未下過任何訂單。</p>
                      ) : (
                        <div className="py-10">
                          <ul className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2">
                            {orders.map((order) => {
                              let qrImage = null;
                              if (order.customer_note) {
                                const match = order.customer_note.match(
                                  /<img[^>]*src="([^"]+)"[^>]*>/
                                );
                                if (match) qrImage = match[1];
                              }

                              return (
                                <li
                                  key={order.id}
                                  className="border border-gray-200 rounded bg-[#1757FF] shadow p-4  flex flex-col justify-between h-full"
                                >
                                  <div className="space-y-2">
                                    <div className="text-gray-100 py-3">
                                      商品：
                                      <ul className="list-disc list-inside">
                                        {order.line_items?.map((item) => (
                                          <li key={item.id}>{item.name}</li>
                                        ))}
                                      </ul>
                                    </div>

                                    <p className="font-medium text-white text-sm mt-3">
                                      訂單編號：{order.id}
                                    </p>

                                    <p className="text-gray-100 text-sm">
                                      狀態：
                                      {{
                                        processing: "已付款完成",
                                        pending: "待付款",
                                        completed: "已完成",
                                        cancelled: "已取消",
                                        on_hold: "待處理",
                                        refunded: "已退款",
                                        failed: "付款失敗",
                                      }[order.status] || order.status}
                                    </p>

                                    {/* ✅ 總金額：四捨五入、不顯示小數 */}
                                    <p className="text-gray-100 text-sm">
                                      總金額：NT$
                                      {formatNTDNoDecimals(order.total)}
                                    </p>

                                    {/* ✅ 訂單建立時間（轉為當地時間格式） */}
                                    <p className="text-gray-100 text-sm">
                                      建立時間：
                                      {new Date(
                                        order.date_created
                                      ).toLocaleString("zh-TW")}
                                    </p>

                                    {/* ✅ 顯示 QRCode 圖片（從 meta_data 抓取） */}
                                    {order.meta_data &&
                                      order.meta_data.find(
                                        (m) => m.key === "esim_qrcode"
                                      )?.value && (
                                        <div className="mt-2">
                                          <p className="text-white mb-1">
                                            eSIM QRCode：
                                          </p>
                                          <img
                                            src={
                                              order.meta_data.find(
                                                (m) => m.key === "esim_qrcode"
                                              )?.value
                                            }
                                            alt="eSIM QRCode"
                                            className="w-40 h-40 object-contain bg-white p-2 rounded"
                                          />
                                        </div>
                                      )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>

                          <AnimatePresence>
                            {selectedImage && (
                              <motion.div
                                key="lightbox"
                                className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setSelectedImage(null)}
                              >
                                <motion.img
                                  src={selectedImage}
                                  alt="QRCode"
                                  className="max-w-[90%] max-h-[90%] rounded-lg shadow-lg border-4 border-white"
                                  initial={{ scale: 0.7 }}
                                  animate={{ scale: 1 }}
                                  exit={{ scale: 0.7 }}
                                />
                                <button
                                  className="absolute top-4 right-4 text-white text-3xl"
                                  onClick={() => setSelectedImage(null)}
                                >
                                  ×
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AccountPage;
