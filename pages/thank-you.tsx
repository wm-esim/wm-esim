// ✅ ThankYouPage.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useCart } from "@/components/context/CartContext";

interface QrcodeInfo {
  name: string;
  src: string;
}

interface OrderInfo {
  status: string | null; // 我們在 /api/fetch-order 會回 SUCCESS / PENDING / FAILED ...
  message?: string | null;
  MerchantOrderNo?: string;
  PaymentType?: string; // e.g. CREDIT / VACC / CVS ...
  PayTime?: string;
  TradeNo?: string;
}

interface OffsiteInfo {
  PaymentType?: string; // VACC / CVS / WEBATM ...
  BankCode?: string; // ATM 銀行代碼
  CodeNo?: string; // ATM 虛擬帳號 或 通用代號欄位
  PaymentNo?: string; // CVS 代碼
  StoreType?: string; // 超商別
  ExpireDate?: string; // 繳費期限
  TradeNo?: string;
  Amt?: number | string;
}

export default function ThankYouPage() {
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [offsiteInfo, setOffsiteInfo] = useState<OffsiteInfo | null>(null);
  const [qrcodes, setQrcodes] = useState<QrcodeInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const { clearCart } = useCart();

  // 從 URL 取出 orderNo（只算一次）
  const orderNo = useMemo(() => {
    if (typeof window === "undefined") return null;
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("orderNo");
  }, []);

  // 防止在同一次瀏覽或重複 render 時「重複清空」
  const clearedOnceRef = useRef(false);

  // 成功判斷：後端回來的狀態只要代表「已付款」
  const isPaid = (status?: string | null) => {
    if (!status) return false;
    const s = String(status).toLowerCase();
    return (
      s === "success" ||
      s === "paid" ||
      s === "successpaid" ||
      s === "success_paid"
    );
  };

  // 文字複製
  const copyText = async (text?: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      alert("已複製到剪貼簿");
    } catch {
      // iOS Safari 等瀏覽器 fallback
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

  useEffect(() => {
    if (!orderNo) {
      setLoading(false);
      return;
    }

    const fetchOrder = async () => {
      try {
        const res = await axios.get("/api/fetch-order", {
          params: { orderNo },
        });
        const { qrcodes, orderInfo, offsiteInfo } = res.data ?? {};

        setOrderInfo(orderInfo || null);
        setOffsiteInfo(offsiteInfo || null);
        setQrcodes(Array.isArray(qrcodes) ? qrcodes : []);

        // ✅ 僅在「確定付款成功」且未清空過時執行 clearCart
        if (!clearedOnceRef.current && isPaid(orderInfo?.status)) {
          clearedOnceRef.current = true;
          clearCart();
        }
      } catch (err) {
        console.error("❌ 抓取訂單資料失敗", err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrder();
  }, [orderNo, clearCart]);

  // 是否顯示匯款/代碼資訊卡：未付款 + 有資料
  const showOffsiteCard =
    !!offsiteInfo && !!orderInfo && !isPaid(orderInfo.status);

  return (
    <div className="max-w-2xl mx-auto px-4 py-20">
      <h1 className="text-2xl font-bold mb-4">感謝您的訂購</h1>

      {/* 訂單摘要 */}
      {orderInfo ? (
        <div className="bg-gray-100 p-6 rounded space-y-2">
          <p>付款狀態：{orderInfo.status}</p>
          {orderInfo.MerchantOrderNo && (
            <>
              <p>訂單編號：{orderInfo.MerchantOrderNo}</p>
              <p>付款方式：{orderInfo.PaymentType || "—"}</p>
              <p>付款時間：{orderInfo.PayTime || "—"}</p>
              <p>交易序號：{orderInfo.TradeNo || "—"}</p>
            </>
          )}
        </div>
      ) : (
        <p>正在解析交易資訊...</p>
      )}

      {/* 匯款/代碼資訊卡（ATM / 超商 等待繳費） */}
      {showOffsiteCard && (
        <div className="mt-6 p-5 rounded-lg border border-yellow-200 bg-yellow-50">
          <h3 className="font-semibold text-yellow-900 mb-3">
            匯款 / 代碼繳費資訊
          </h3>

          {/* ATM 匯款（VACC / WEBATM） */}
          {(offsiteInfo?.PaymentType === "VACC" ||
            offsiteInfo?.PaymentType === "WEBATM") && (
            <div className="space-y-2">
              <p>
                銀行代碼：
                <span className="font-mono">
                  {offsiteInfo.BankCode || "—"}
                </span>{" "}
                <button
                  className="ml-2 text-sm underline text-blue-700"
                  onClick={() => copyText(offsiteInfo.BankCode)}
                >
                  複製
                </button>
              </p>
              <p>
                虛擬帳號：
                <span className="font-mono break-all">
                  {offsiteInfo.CodeNo || "—"}
                </span>{" "}
                <button
                  className="ml-2 text-sm underline text-blue-700"
                  onClick={() => copyText(offsiteInfo.CodeNo)}
                >
                  複製
                </button>
              </p>
              <p>繳費期限：{offsiteInfo.ExpireDate || "—"}</p>
              {offsiteInfo.Amt && <p>應繳金額：${offsiteInfo.Amt}</p>}
              <p className="text-sm text-gray-600">
                ※ 請於期限內完成匯款，逾期訂單將自動失效。
              </p>
            </div>
          )}

          {/* 超商代碼（CVS） */}
          {offsiteInfo?.PaymentType === "CVS" && (
            <div className="space-y-2">
              <p>超商別：{offsiteInfo.StoreType || "—"}</p>
              <p>
                繳費代碼：
                <span className="font-mono break-all">
                  {offsiteInfo.PaymentNo || offsiteInfo.CodeNo || "—"}
                </span>{" "}
                <button
                  className="ml-2 text-sm underline text-blue-700"
                  onClick={() =>
                    copyText(offsiteInfo.PaymentNo || offsiteInfo.CodeNo)
                  }
                >
                  複製
                </button>
              </p>
              <p>繳費期限：{offsiteInfo.ExpireDate || "—"}</p>
              {offsiteInfo.Amt && <p>應繳金額：${offsiteInfo.Amt}</p>}
              <p className="text-sm text-gray-600">
                ※ 請於期限內至指定超商櫃檯或機台繳費，逾期訂單將自動失效。
              </p>
            </div>
          )}

          {/* 其它待繳型式（保險） */}
          {!["VACC", "WEBATM", "CVS"].includes(
            String(offsiteInfo?.PaymentType || "")
          ) && (
            <div className="space-y-2">
              <p>付款方式：{offsiteInfo?.PaymentType || "—"}</p>
              {offsiteInfo?.CodeNo && (
                <p>
                  代碼：
                  <span className="font-mono break-all">
                    {offsiteInfo.CodeNo}
                  </span>{" "}
                  <button
                    className="ml-2 text-sm underline text-blue-700"
                    onClick={() => copyText(offsiteInfo.CodeNo)}
                  >
                    複製
                  </button>
                </p>
              )}
              {offsiteInfo?.ExpireDate && (
                <p>繳費期限：{offsiteInfo.ExpireDate}</p>
              )}
              {offsiteInfo?.Amt && <p>應繳金額：${offsiteInfo.Amt}</p>}
            </div>
          )}
        </div>
      )}

      {/* QR Codes（已付款才通常會有，依你的後端邏輯而定） */}
      <div className="mt-10">
        {loading && <p>正在載入 QRCode...</p>}

        {!loading && qrcodes.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold mb-2">
              請掃描下方 QRCode 啟用 eSIM
            </h2>
            {qrcodes.map((qrcode, index) => (
              <div key={index} className="text-center">
                <p className="font-semibold mb-2">{qrcode.name}</p>
                <img
                  src={qrcode.src}
                  alt={`eSIM QRCode ${index + 1}`}
                  className="w-64 h-64 mx-auto"
                />
              </div>
            ))}
          </div>
        )}

        {!loading && qrcodes.length === 0 && (
          <p className="text-red-500">無法取得 QRCode，請聯繫客服協助。</p>
        )}
      </div>
    </div>
  );
}
