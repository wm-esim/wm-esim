"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import Layout from "./Layout";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

/* ========== 小工具 ========== */
const log = (...args) => console.log("[Account]", ...args);
const warn = (...args) => console.warn("[Account]", ...args);
const error = (...args) => console.error("[Account]", ...args);

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
    on_hold: "待付款",
    refunded: "已退款",
    failed: "付款失敗",
  }[status] || status);

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
    } catch (e) {
      warn("解析 esim_qrcodes 失敗：", e);
    }
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

/* ====== 讀取非即時付款資訊（VACC/CVS/WEBATM） ====== */
const OFFSITE_TYPES = new Set(["VACC", "CVS", "WEBATM"]);
function readOffsiteInfo(order) {
  const meta = order?.meta_data || [];
  const getMeta = (k) => meta.find((m) => m?.key === k)?.value;

  // 優先：newebpay_offsite_info（JSON）
  let info = null;
  const rawInfo = getMeta("newebpay_offsite_info");
  if (rawInfo) {
    try {
      info = typeof rawInfo === "string" ? JSON.parse(rawInfo) : rawInfo;
    } catch {}
  }

  // 次之：個別欄位
  const paymentType = (
    info?.PaymentType ||
    getMeta("newebpay_payment_type") ||
    order?.paymentType ||
    order?.payment_method_title ||
    ""
  )
    .toString()
    .toUpperCase();

  const bank = info?.BankCode || getMeta("newebpay_bank_code") || "";
  const codeNo =
    info?.CodeNo || info?.PaymentNo || getMeta("newebpay_code_no") || "";
  const expire = info?.ExpireDate || getMeta("newebpay_expire_date") || "";
  const tradeNo = info?.TradeNo || "";

  // 是否已付款（看 meta 是否有 pay_time）
  const paidTime = getMeta("newebpay_pay_time");
  const isPaid =
    Boolean(paidTime) || ["processing", "completed"].includes(order?.status);

  return {
    paymentType,
    bankCode: bank,
    codeNo,
    expireDate: expire,
    tradeNo,
    amount: order?.total,
    isPaid,
    // 此訂單是否「尚未入帳」且為非即時付款類型
    show:
      OFFSITE_TYPES.has(paymentType) &&
      !isPaid &&
      ["on_hold", "pending"].includes(order?.status),
  };
}

/* ===== Skeleton ===== */
const OrderSkeletonGrid = ({ count = 8 }) => (
  <ul className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
    {Array.from({ length: count }).map((_, i) => (
      <li key={i} className="border border-gray-200 rounded bg-white p-4">
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-3/4" />
          <div className="h-24 bg-gray-100 rounded" />
        </div>
      </li>
    ))}
  </ul>
);

/* ========== 主頁面 ========== */
const AccountPage = () => {
  const [userInfo, setUserInfo] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState("info"); // info | qrcode | remit
  const [editingEmail, setEditingEmail] = useState("");
  const [editingPhone, setEditingPhone] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editMode, setEditMode] = useState(false);
  const router = useRouter();

  /** 依 userId/email 抓訂單（同時帶兩者，讓後端可 fallback） */
  const fetchOrders = useCallback(async (u) => {
    if (!u) return [];
    const qs = new URLSearchParams({
      ...(u.id ? { userId: String(u.id) } : {}),
      ...(u.email ? { email: String(u.email) } : {}),
    }).toString();

    log("呼叫 /api/get-orders，query =", qs);
    const res = await fetch(`/api/get-orders?${qs}`);
    if (!res.ok) {
      error("get-orders 失敗，HTTP", res.status);
      throw new Error(`get-orders ${res.status}`);
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    log(
      "get-orders 回傳筆數：",
      list.length,
      list.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total,
      }))
    );
    return list;
  }, []);

  /** 包裝訂單載入流程（含 loading 標記） */
  const loadOrders = useCallback(
    async (u) => {
      if (!u) return;
      setOrdersLoading(true);
      try {
        const list = await fetchOrders(u);
        setOrders(list);
      } catch (e) {
        error("抓訂單失敗：", e?.message);
      } finally {
        setOrdersLoading(false);
        setOrdersLoaded(true);
      }
    },
    [fetchOrders]
  );

  // 讀會員與訂單（具備 token 403 的 fallback）
  useEffect(() => {
    const token = localStorage.getItem("token");
    const storedUser = (() => {
      try {
        return JSON.parse(localStorage.getItem("user") || "null");
      } catch {
        return null;
      }
    })();

    if (!token && !storedUser) {
      warn("沒有 token 與 localStorage user → 導回登入頁");
      router.push("/login");
      return;
    }

    const load = async () => {
      let user = storedUser;

      if (token) {
        try {
          log("以 token 呼叫 WP /users/me");
          const r = await fetch("https://fegoesim.com/wp-json/wp/v2/users/me", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) throw new Error(`users/me HTTP ${r.status}`);
          user = await r.json();
          localStorage.setItem("user", JSON.stringify(user));
          log("users/me 成功，user.id =", user?.id, "email =", user?.email);
        } catch (e) {
          warn(
            "users/me 失敗（常見 403 JWT 無效），改用 localStorage user。err =",
            e?.message
          );
        }
      }

      if (!user) {
        warn("沒有 user 可用 → 導回登入頁");
        router.push("/login");
        return;
      }

      setUserInfo(user);
      setEditingEmail(user.email || "");
      setEditingPhone(user.meta?.billing_phone || "");
      setEditingName(user.name || "");

      // 初次載入就把訂單抓好（避免切到分頁才抓）
      await loadOrders(user);
    };

    load().catch((e) => {
      error("初始化 load() 例外：", e?.message);
      router.push("/login");
    });

    const fav = JSON.parse(localStorage.getItem("favorites") || "[]");
    setFavorites(fav);
  }, [router, loadOrders]);

  // 切到「QRCode 訂單」或「匯款資訊」時，如果尚未載入完成就觸發載入（雙保險）
  useEffect(() => {
    if (
      (activeTab === "qrcode" || activeTab === "remit") &&
      !ordersLoaded &&
      userInfo
    ) {
      loadOrders(userInfo);
    }
  }, [activeTab, ordersLoaded, userInfo, loadOrders]);

  const handleProfileUpdate = async () => {
    const token = localStorage.getItem("token");
    if (!token || !userInfo?.id) {
      warn("缺少 token 或 user.id，無法更新會員資料");
      return;
    }

    try {
      log("送出會員資料更新");
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
        log("會員資料更新成功");
        setUserInfo(data);
        setEditMode(false);
        localStorage.setItem("user", JSON.stringify(data));
        alert("會員資料更新成功");
      } else {
        warn("會員資料更新失敗：", data);
        alert(data.message || "更新失敗");
      }
    } catch (err) {
      error("更新會員資料時發生錯誤", err);
    }
  };

  /* ===== 匯款資訊：UI & 邏輯 ===== */
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      alert("已複製到剪貼簿");
    } catch (e) {
      warn("無法複製（瀏覽器權限受限）", e?.message);
    }
  };

  const refreshOrders = async () => {
    if (userInfo) await loadOrders(userInfo);
  };

  if (!userInfo)
    return <p className="mt-40 text-center">正在載入會員資料...</p>;

  // 依現有訂單，挑出需要顯示匯款資訊的
  const remitOrders = (orders || [])
    .map((o) => ({ order: o, remit: readOffsiteInfo(o) }))
    .filter((x) => x.remit.show);

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
                  <li>
                    <button
                      onClick={() => setActiveTab("remit")}
                      className={`block w-full text-left px-4 py-2 rounded-[5px] ${
                        activeTab === "remit"
                          ? "bg-[#1757FF] text-white font-bold"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      匯款資訊
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

                      {ordersLoading ? (
                        <OrderSkeletonGrid count={8} />
                      ) : orders.length === 0 ? (
                        <p>尚未下過任何訂單。</p>
                      ) : (
                        <div className="py-6">
                          <ul className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                            {orders.map((order) => {
                              const meta = order.meta_data || [];
                              const qrs = readQRCodes(meta);
                              const payType =
                                order.paymentType ||
                                order.payment_method_title ||
                                "—";

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
                                      <p>付款方式：{payType}</p>
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

                  {/* 匯款資訊 */}
                  {activeTab === "remit" && (
                    <motion.div
                      key="remit"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      className=" top-0 left-0 w-full bg-white rounded-[6px] p-4 sm:p-8"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold">
                          匯款 / 繳費資訊
                        </h2>
                        <button
                          onClick={refreshOrders}
                          className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200"
                        >
                          重新整理
                        </button>
                      </div>

                      {ordersLoading ? (
                        <OrderSkeletonGrid count={4} />
                      ) : remitOrders.length === 0 ? (
                        <p className="text-gray-600">
                          目前沒有待匯款 / 待繳費的訂單。
                          若您剛完成付款，請點上方「重新整理」更新狀態。
                        </p>
                      ) : (
                        <ul className="space-y-4">
                          {remitOrders.map(({ order, remit }) => (
                            <li key={order.id} className="border rounded p-4">
                              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                <div>
                                  <p className="text-sm text-gray-500">
                                    訂單編號 #{order.id}
                                  </p>
                                  <p className="font-semibold">
                                    付款方式：{remit.paymentType}
                                  </p>
                                </div>
                                <div className="text-sm text-gray-600">
                                  金額：NT$
                                  <span className="font-semibold">
                                    {formatNTDNoDecimals(order.total)}
                                  </span>
                                </div>
                              </div>

                              <div className="grid sm:grid-cols-2 gap-3 text-sm mt-3">
                                {remit.bankCode && (
                                  <div className="bg-gray-50 rounded p-3">
                                    <p className="text-gray-500">銀行代碼</p>
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold">
                                        {remit.bankCode}
                                      </span>
                                      <button
                                        onClick={() => copy(remit.bankCode)}
                                        className="px-2 py-0.5 text-xs rounded bg-gray-200 hover:bg-gray-300"
                                      >
                                        複製
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {remit.codeNo && (
                                  <div className="bg-gray-50 rounded p-3">
                                    <p className="text-gray-500">
                                      {remit.paymentType === "VACC"
                                        ? "轉帳帳號"
                                        : "繳費代碼"}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold break-all">
                                        {remit.codeNo}
                                      </span>
                                      <button
                                        onClick={() => copy(remit.codeNo)}
                                        className="px-2 py-0.5 text-xs rounded bg-gray-200 hover:bg-gray-300"
                                      >
                                        複製
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {remit.expireDate && (
                                  <div className="bg-gray-50 rounded p-3">
                                    <p className="text-gray-500">繳費期限</p>
                                    <p className="font-semibold">
                                      {remit.expireDate}
                                    </p>
                                  </div>
                                )}
                                {remit.tradeNo && (
                                  <div className="bg-gray-50 rounded p-3">
                                    <p className="text-gray-500">交易序號</p>
                                    <p className="font-semibold">
                                      {remit.tradeNo}
                                    </p>
                                  </div>
                                )}
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                {/* 前往 pending 頁面（以商店訂單號 newebpay_order_no 為主；若沒有就用 Woo id） */}
                                {(() => {
                                  const meta = order.meta_data || [];
                                  const npNo = meta.find(
                                    (m) => m?.key === "newebpay_order_no"
                                  )?.value;
                                  const orderNo = npNo || String(order.id);
                                  return (
                                    <Link
                                      href={`/pending?orderNo=${encodeURIComponent(
                                        orderNo
                                      )}`}
                                      className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm"
                                    >
                                      前往訂單追蹤
                                    </Link>
                                  );
                                })()}
                                <button
                                  onClick={refreshOrders}
                                  className="px-3 py-1.5 rounded border text-sm"
                                >
                                  我已完成付款，重新整理狀態
                                </button>
                              </div>

                              <p className="text-xs text-gray-500 mt-3">
                                ＊完成轉帳或繳費後，系統會自動更新訂單狀態（通常數分鐘內）。
                                若長時間未更新，請聯繫客服並提供訂單編號與付款憑證。
                              </p>
                            </li>
                          ))}
                        </ul>
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
