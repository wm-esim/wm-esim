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

export default function ThankYouPage() {
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
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

        const { qrcode, orderInfo } = res.data;

        setOrderInfo(orderInfo || null);
        setQrcode(qrcode || null);
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
        <div className="bg-gray-100 p-6 rounded">
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

        {!loading && qrcode && (
          <div>
            <h2 className="text-xl font-bold mb-2">
              請掃描下方 QRCode 啟用 eSIM
            </h2>
            <img src={qrcode} alt="eSIM QRCode" className="w-64 h-64 mx-auto" />
          </div>
        )}

        {!loading && !qrcode && (
          <p className="text-red-500">無法取得 QRCode，請聯繫客服協助。</p>
        )}
      </div>
    </div>
  );
}
