"use client";

import { useEffect, useState } from "react";
import axios from "axios";

interface OrderInfo {
  status: string | null;
  message?: string | null;
  MerchantOrderNo?: string;
  PaymentType?: string;
  PayTime?: string;
  TradeNo?: string;
}

interface QrcodeItem {
  name: string;
  src: string;
}

export default function ThankYouPage() {
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [qrcodes, setQrcodes] = useState<QrcodeItem[]>([]);
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
        setQrcodes(Array.isArray(qrcodes) ? qrcodes : []);
      } catch (err) {
        console.error("❌ 抓取訂單資料失敗", err);
      } finally {
        setLoading(false);
      }
    };

    fetchQrcode();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-20">
      <h1 className="text-3xl font-bold mb-6 text-center">感謝您的訂購</h1>

      {orderInfo ? (
        <div className="bg-gray-100 p-6 rounded mb-10 shadow">
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

      <div>
        {loading && <p className="text-center">正在載入 QRCode...</p>}

        {!loading && qrcodes.length > 0 && (
          <div className="space-y-8">
            {qrcodes.map((item, idx) => (
              <div
                key={idx}
                className="border p-6 rounded shadow flex flex-col items-center"
              >
                <h2 className="text-xl font-semibold mb-4 text-center">
                  {item.name}
                </h2>
                <img
                  src={item.src}
                  alt={`QRCode for ${item.name}`}
                  className="w-64 h-64"
                />
              </div>
            ))}
          </div>
        )}

        {!loading && qrcodes.length === 0 && (
          <p className="text-red-500 text-center">
            無法取得 QRCode，請聯繫客服協助。
          </p>
        )}
      </div>
    </div>
  );
}
