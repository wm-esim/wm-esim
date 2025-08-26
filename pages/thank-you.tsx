// ✅ ThankYouPage.tsx
"use client";

import { useEffect, useState } from "react";
import axios from "axios";

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
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [qrcodes, setQrcodes] = useState<QrcodeInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const orderNo = urlParams.get("orderNo");

    if (!orderNo) return;

    const fetchQrcode = async () => {
      try {
        const res = await axios.get("/api/fetch-order", {
          params: { orderNo },
        });

        const { qrcodes, orderInfo } = res.data;

        setOrderInfo(orderInfo || null);
        setQrcodes(qrcodes || []);
      } catch (err) {
        console.error("❌ 抓取訂單資料失敗", err);
      } finally {
        setLoading(false);
      }
    };

    fetchQrcode();
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-20">
      <h1 className="text-2xl font-bold mb-4">感謝您的訂購</h1>

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
