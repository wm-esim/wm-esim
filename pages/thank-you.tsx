// ✅ ThankYouPage.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useCart } from "@/components/context/CartContext";

interface QrcodeInfo {
  name: string;
  src: string;
}

interface OrderInfo {
  status: string | null;
  message?: string | null;
  MerchantOrderNo?: string;
  PaymentType?: string;
  PayTime?: string;
  TradeNo?: string;
}

export default function ThankYouPage() {
  // 狀態管理
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [qrcodes, setQrcodes] = useState<QrcodeInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const { clearCart } = useCart();

  // 防止重複執行清空購物車
  const clearedOnceRef = useRef(false);

  // 1. 初始化：決定要用哪個訂單編號 (URL vs LocalStorage)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const urlParams = new URLSearchParams(window.location.search);
    let targetOrderNo = urlParams.get("orderNo");
    const status = urlParams.get("status");

    // ★★★ 關鍵救援邏輯 ★★★
    // 如果 URL 沒有 orderNo，或者後端指示 "LOCAL_BACKUP" (代表解密失敗但已付款)
    if (!targetOrderNo || targetOrderNo === "LOCAL_BACKUP") {
      const savedOrderNo = localStorage.getItem("lastOrderNo");
      if (savedOrderNo) {
        // 去除可能存在的引號 (因為 localStorage 有時存的是 JSON 字串)
        targetOrderNo = savedOrderNo.replace(/^"|"$/g, "");
        console.log("⚠️ 啟動救援機制，使用本地備份單號:", targetOrderNo);
      }
    }

    if (targetOrderNo) {
      setOrderNo(targetOrderNo);
    } else {
      // 真的完全找不到單號
      setLoading(false);
    }
  }, []);

  // 2. 當有單號時，去後端抓 QRCode
  useEffect(() => {
    if (!orderNo) return;

    const fetchQrcode = async () => {
      try {
        setLoading(true);
        // 呼叫我們修好的 API (確保 fetch-order.ts 已經是包含 SSL fix 的版本)
        const res = await axios.get("/api/fetch-order", {
          params: { orderNo },
        });

        const { qrcodes, orderInfo } = res.data ?? {};

        setOrderInfo(orderInfo || null);
        setQrcodes(Array.isArray(qrcodes) ? qrcodes : []);

        // 判斷是否已付款 (包含後端回傳的狀態或 URL 的狀態)
        const isPaid =
          checkIsPaid(orderInfo?.status) || checkIsPaid(orderInfo?.wooStatus);

        // ✅ 僅在「確定付款成功」且未清空過時執行 clearCart
        if (!clearedOnceRef.current && isPaid) {
          clearedOnceRef.current = true;
          clearCart();
          // 清除本地備份，避免下次誤用 (可選)
          localStorage.removeItem("lastOrderNo");
        }
      } catch (err) {
        console.error("❌ 抓取訂單資料失敗", err);
      } finally {
        setLoading(false);
      }
    };

    fetchQrcode();
  }, [orderNo, clearCart]);

  // 輔助函式：寬鬆判斷付款狀態
  const checkIsPaid = (status?: string | null) => {
    if (!status) return false;
    const s = String(status).toLowerCase();
    return (
      s === "success" ||
      s === "paid" ||
      s === "processing" ||
      s === "completed" ||
      s === "successpaid"
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-20">
      <h1 className="text-2xl font-bold mb-4">感謝您的訂購</h1>

      {loading ? (
        <p>正在解析交易資訊...</p>
      ) : orderInfo ? (
        <div className="bg-gray-100 p-6 rounded space-y-2">
          <p>
            付款狀態：
            <span
              className={
                checkIsPaid(orderInfo.status)
                  ? "text-green-600 font-bold"
                  : "text-red-600"
              }
            >
              {checkIsPaid(orderInfo.status) ? "付款成功" : orderInfo.status}
            </span>
          </p>
          <p>訂單編號：{orderInfo.MerchantOrderNo || orderNo}</p>

          {orderInfo.PaymentType && <p>付款方式：{orderInfo.PaymentType}</p>}
          {orderInfo.PayTime && <p>付款時間：{orderInfo.PayTime}</p>}
          {orderInfo.TradeNo && <p>交易序號：{orderInfo.TradeNo}</p>}
        </div>
      ) : (
        <div className="bg-red-50 p-6 rounded border border-red-200">
          <p className="text-red-600">
            無法讀取訂單資訊，但若您已收到付款通知信，請檢查 Email 信箱。
          </p>
          <p className="text-sm text-gray-500 mt-2">
            單號：{orderNo || "未知"}
          </p>
        </div>
      )}

      <div className="mt-10">
        {!loading && qrcodes.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-2">
              請掃描下方 QRCode 啟用 eSIM
            </h2>
            {qrcodes.map((qrcode, index) => (
              <div
                key={index}
                className="text-center border p-4 rounded-lg bg-white shadow-sm"
              >
                <p className="font-semibold mb-2">{qrcode.name}</p>
                {/* 使用 img 顯示 base64 或網址 */}
                <img
                  src={qrcode.src}
                  alt={`eSIM QRCode ${index + 1}`}
                  className="w-64 h-64 mx-auto object-contain"
                />
              </div>
            ))}
          </div>
        )}

        {!loading && qrcodes.length === 0 && orderInfo && (
          <p className="text-red-500 mt-4">
            尚無 QRCode 資料。系統可能正在生成中，請稍後重整頁面，或檢查您的
            Email。
          </p>
        )}
      </div>
    </div>
  );
}
