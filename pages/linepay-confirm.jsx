"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function LinePayConfirm() {
  const router = useRouter();
  const { orderId, amount } = router.query;

  const [status, setStatus] = useState("processing");

  useEffect(() => {
    if (!orderId || !amount) return;

    const email = localStorage.getItem("checkoutEmail") || "user@example.com";
    const cartItems = JSON.parse(localStorage.getItem("cartItems") || "[]");

    // ✅ 向後端確認 LINE Pay 交易資訊（包含 transactionId）
    fetch(`/api/linepay/confirm-transaction?orderId=${orderId}`)
      .then((res) => res.json())
      .then((confirmData) => {
        const transactionId = String(confirmData?.info?.transactionId || "");

        if (!transactionId) {
          console.error("❌ 無法取得 transactionId", confirmData);
          setStatus("fail");
          return;
        }

        // ✅ 發送 callback 請求，建立訂單 / 寄信 / 發票等
        return fetch("/api/linepay/linepay-callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId,
            orderId: String(orderId),
            amount: Number(amount),
            email,
            cartItems,
          }),
        });
      })
      .then(async (res) => {
        if (!res || !res.ok) {
          const err = res ? await res.json() : { error: "callback 無回應" };
          console.error("❌ callback error:", err);
          setStatus("fail");
        } else {
          const data = await res.json();
          console.log("✅ callback success:", data);
          setStatus("success");
        }
      })
      .catch((err) => {
        console.error("❌ 發送 callback 錯誤:", err);
        setStatus("fail");
      });
  }, [orderId, amount]);

  return (
    <div className="p-10 text-center">
      {status === "processing" && <p>正在確認付款中，請稍候...</p>}
      {status === "success" && (
        <p className="text-green-600 text-xl">
          ✅ 付款成功！我們已收到您的付款。
        </p>
      )}
      {status === "fail" && (
        <p className="text-red-600 text-xl">
          ❌ 付款失敗，請聯繫客服或重新操作。
        </p>
      )}
    </div>
  );
}
