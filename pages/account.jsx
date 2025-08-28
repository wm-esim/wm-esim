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
  const n = Number(String(val).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  return rounded.toLocaleString("zh-TW");
};

/** 狀態中文 */
const statusLabel = (status) =>
  ({
    processing: "已付款完成",
    pending: "待付款",
    completed: "已完成",
    cancelled: "已取消",
    on_hold: "待付款", // 調整成待付款（原本是待處理）
    refunded: "已退款",
    failed: "付款失敗",
  }[status] || status);

/** 從 meta_data 取出 offsite 資訊（ATM/超商/其它代碼繳費） */
function readOffsiteInfo(meta) {
  if (!Array.isArray(meta)) return null;
  const raw = meta.find((m) => m?.key === "newebpay_offsite_info")?.value;
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** 付款方式（若 meta 有 newebpay_payment_type 優先） */
function readPaymentType(meta, fallback) {
  if (!Array.isArray(meta)) return fallback || "";
  return (
    meta.find((m) => m?.key === "newebpay_payment_type")?.value ||
    fallback ||
    ""
  );
}

/** 支援多張 QRCode（esim_qrcodes）或單張（esim_qrcode + 數量） */
function readQRCodes(meta, namePrefix = "eSIM") {
  const results = [];
  if (!Array.isArray(meta)) return results;

  const multi = meta.find((m) => m?.key === "esim_qrcodes")?.value;
  const single = meta.find((m) => m?.key === "esim_qrcode")?.value;
  const qtyStr = meta.find((m) => m?.key === "esim_quantity")?.value;
  const qty = Math.max(1, parseInt(String(qtyStr || "1"), 10));

  const normalizeSrc = (raw) => {
    const str = String(raw || "");
    if (!str) return "";
    return str.startsWith("http") || str.startsWith("data:image/")
      ? str
      : `data:image/png;base64,${str}`;
  };

  if (multi) {
    try {
      const parsed = typeof multi === "string" ? JSON.parse(multi) : multi;
      if (Array.isArray(parsed)) {
        parsed.forEach((it, idx) => {
          const src = normalizeSrc(it?.src ?? it);
          if (src) results.push({ name: `${namePrefix} #${idx + 1}`, src });
        });
      }
    } catch {}
  } else if (single) {
    const src = normalizeSrc(single);
    if (src) {
      for (let i = 0; i < qty; i++) {
        results.push({ name: `${namePrefix} #${i + 1}`, src });
      }
    }
  }

  return results;
}

/** 把字串日期轉成在地時間（有些回傳是 "YYYY-MM-DD hh:mm:ss"） */
const fmtDT = (s) =>
  s ? new Date(s.replace(/-/g, "/")).toLocaleString("zh-TW") : "—";

const AccountPage = () => {
  const [userInfo, setUserInfo] = useState(null);
  const [orders, setOrders] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState("info"); // info | qrcode | payment
  const [editingEmail, setEditingEmail] = useState("");
  const [editingPhone, setEditingPhone] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const router = useRouter();

  const copyText = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      alert("已複製到剪貼簿");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        alert("已複製到剪貼簿");
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  // 讀會員與訂單
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
        const list = Array.isArray(data) ? data : [];
        setOrders(list);
        // 只要有 pending/on_hold 且帶有 offsite 資訊，就自動切到繳費分頁
        const hasPending = list.some(
          (o) =>
            ["pending", "on_hold"].includes(o.status) &&
            !!readOffsiteInfo(o.meta_data || [])
        );
        if (hasPending) setActiveTab("payment");
      })
      .catch(() => router.push("/login"));

    const storedFavorites = JSON.parse(
      localStorage.getItem("favorites") || "[]"
    );
    setFavorites(storedFavorites);
  }, [router]);

  // 在繳費分頁時每 15 秒刷新一次訂單狀態
  useEffect(() => {
    if (activeTab !== "payment" || !userInfo?.id) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/get-orders?userId=${userInfo.id}`);
        const list = await res.json();
        if (Array.isArray(list)) setOrders(list);
      } catch {}
    }, 15000);
    return () => clearInterval(timer);
  }, [activeTab, userInfo?.id]);

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

  // ==== 繳費資訊卡片 ====
  const OffsiteCard = ({ offsite }) => {
    if (!offsite) return null;

    const type = String(offsite?.PaymentType || "").toUpperCase();
    const isATM = type === "VACC" || type === "WEBATM";
    const isCVS = type === "CVS";

    return (
      <div className="mt-2 p-4 rounded-[8px] border border-yellow-200 bg-yellow-50">
        <p className="font-semibold text-yellow-900 mb-2">
          匯款 / 代碼繳費資訊
        </p>

        {isATM && (
          <div className="space-y-1 text-sm">
            <p>
              銀行代碼：
              <span className="font-mono">{offsite.BankCode || "—"}</span>
              <button
                className="ml-2 underline text-blue-700"
                onClick={() => copyText(offsite.BankCode)}
              >
                複製
              </button>
            </p>
            <p>
              虛擬帳號：
              <span className="font-mono break-all">
                {offsite.CodeNo || "—"}
              </span>
              <button
                className="ml-2 underline text-blue-700"
                onClick={() => copyText(offsite.CodeNo)}
              >
                複製
              </button>
            </p>
            {!!offsite.Amt && (
              <p>應繳金額：NT${formatNTDNoDecimals(offsite.Amt)}</p>
            )}
            <p>繳費期限：{fmtDT(offsite.ExpireDate)}</p>
          </div>
        )}

        {isCVS && (
          <div className="space-y-1 text-sm">
            <p>超商別：{offsite.StoreType || "—"}</p>
            <p>
              繳費代碼：
              <span className="font-mono break-all">
                {offsite.PaymentNo || offsite.CodeNo || "—"}
              </span>
              <button
                className="ml-2 underline text-blue-700"
                onClick={() => copyText(offsite.PaymentNo || offsite.CodeNo)}
              >
                複製
              </button>
            </p>
            {!!offsite.Amt && (
              <p>應繳金額：NT${formatNTDNoDecimals(offsite.Amt)}</p>
            )}
            <p>繳費期限：{fmtDT(offsite.ExpireDate)}</p>
          </div>
        )}

        {!isATM && !isCVS && (
          <div className="space-y-1 text-sm">
            <p>付款方式：{offsite?.PaymentType || "—"}</p>
            {!!offsite?.CodeNo && (
              <p>
                代碼：
                <span className="font-mono break-all">{offsite.CodeNo}</span>
                <button
                  className="ml-2 underline text-blue-700"
                  onClick={() => copyText(offsite.CodeNo)}
                >
                  複製
                </button>
              </p>
            )}
            {!!offsite?.Amt && (
              <p>應繳金額：NT${formatNTDNoDecimals(offsite.Amt)}</p>
            )}
            {!!offsite?.ExpireDate && (
              <p>繳費期限：{fmtDT(offsite.ExpireDate)}</p>
            )}
          </div>
        )}

        <p className="text-xs text-gray-600 mt-2">
          ※ 若逾期未繳，訂單將自動失效；如需協助請聯繫客服。
        </p>
      </div>
    );
  };

  return (
    <Layout>
      <div className=" bg-[#f7f8f9] flex flex-col justify-center items-center">
        <div className="w-full py-20">
          <div className="dashdoard max-w-[1920px] w-[95%] xl:w-[85%] mx-auto py-8 2xl:py-20">
            {/* 麵包屑 */}
            <div className="navgation flex max-w-[1920px] w-[80%] mb-8">
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
              {/* 左側分頁 */}
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
                  {/* ✅ 新增：繳費資訊分頁按鈕 */}
                  <li>
                    <button
                      onClick={() => setActiveTab("payment")}
                      className={`block w-full text-left px-4 py-2 rounded-[5px] ${
                        activeTab === "payment"
                          ? "bg-[#1757FF] text-white font-bold"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      繳費資訊
                    </button>
                  </li>
                </ul>
              </div>

              {/* 右側內容 */}
              <div className="info w-full lg:w-[80%] relative mb-10 min-h-[600px]">
                <AnimatePresence mode="wait">
                  {/* 會員資料 */}
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

                  {/* QRCode / 訂單 */}
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
                        <div className="py-6">
                          <ul className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                            {orders.map((order) => {
                              const meta = order.meta_data || [];
                              const qrs = readQRCodes(meta);
                              const payType = readPaymentType(
                                meta,
                                order.payment_method_title
                              );

                              return (
                                <li
                                  key={order.id}
                                  className="border border-gray-200 rounded bg-white shadow-sm p-4 flex flex-col justify-between h-full"
                                >
                                  <div className="space-y-3">
                                    <div className="text-gray-700">
                                      <div className="font-semibold mb-1">
                                        商品：
                                      </div>
                                      <ul className="list-disc list-inside text-sm">
                                        {order.line_items?.map((item) => (
                                          <li key={item.id}>{item.name}</li>
                                        ))}
                                      </ul>
                                    </div>

                                    <div className="text-sm text-gray-600">
                                      <p className="mt-1">
                                        訂單編號：
                                        <span className="font-medium">
                                          {order.id}
                                        </span>
                                      </p>
                                      <p>
                                        狀態：
                                        <span className="font-medium">
                                          {statusLabel(order.status)}
                                        </span>
                                      </p>
                                      <p>
                                        總金額：NT$
                                        <span className="font-medium">
                                          {formatNTDNoDecimals(order.total)}
                                        </span>
                                      </p>
                                      <p>
                                        建立日期：
                                        {new Date(
                                          order.date_created
                                        ).toLocaleDateString("zh-TW")}
                                      </p>
                                      <p>付款方式：{payType || "—"}</p>
                                    </div>

                                    {/* eSIM QRCode（若有） */}
                                    {qrs.length > 0 && (
                                      <div className="mt-2">
                                        <p className="mb-2 font-medium">
                                          eSIM QRCode：
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                          {qrs.map((q, idx) => (
                                            <div
                                              key={idx}
                                              className="bg-white p-2 rounded border"
                                            >
                                              <img
                                                src={q.src}
                                                alt={q.name}
                                                className="w-full aspect-square object-contain"
                                              />
                                              <p className="text-xs mt-1 text-gray-600">
                                                {q.name}
                                              </p>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* 繳費資訊（只列出 pending/on_hold 且有 offsite 的訂單） */}
                  {activeTab === "payment" && (
                    <motion.div
                      key="payment"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      className=" top-0 left-0 w-full bg-white rounded-[6px] p-4 sm:p-8"
                    >
                      <h2 className="text-2xl font-semibold mb-4">繳費資訊</h2>
                      {orders.length === 0 ? (
                        <p>尚未下過任何訂單。</p>
                      ) : (
                        <div className="py-6">
                          {(() => {
                            const needPay = orders
                              .map((o) => ({
                                order: o,
                                offsite: readOffsiteInfo(o.meta_data || []),
                              }))
                              .filter(
                                (x) =>
                                  x.offsite &&
                                  ["pending", "on_hold"].includes(
                                    x.order.status
                                  )
                              );

                            if (needPay.length === 0) {
                              return (
                                <p className="text-gray-600">
                                  目前沒有待繳的訂單。
                                </p>
                              );
                            }

                            return (
                              <ul className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                                {needPay.map(({ order, offsite }) => {
                                  const payType = readPaymentType(
                                    order.meta_data || [],
                                    order.payment_method_title
                                  );
                                  return (
                                    <li
                                      key={order.id}
                                      className="border border-gray-200 rounded bg-white shadow-sm p-4 flex flex-col justify-between h-full"
                                    >
                                      <div className="space-y-3">
                                        <div className="text-sm text-gray-600">
                                          <p className="mt-1">
                                            訂單編號：
                                            <span className="font-medium">
                                              {order.id}
                                            </span>
                                          </p>
                                          <p>
                                            狀態：
                                            <span className="font-medium">
                                              {statusLabel(order.status)}
                                            </span>
                                          </p>
                                          <p>
                                            總金額：NT$
                                            <span className="font-medium">
                                              {formatNTDNoDecimals(order.total)}
                                            </span>
                                          </p>
                                          <p>付款方式：{payType || "—"}</p>
                                        </div>

                                        <OffsiteCard offsite={offsite} />
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            );
                          })()}
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
