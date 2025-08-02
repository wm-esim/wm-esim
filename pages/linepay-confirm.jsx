// pages/linepay-confirm.tsx
import { useEffect } from "react";
import { useRouter } from "next/router";

export default function LinePayConfirmPage() {
  const router = useRouter();
  const { transactionId, orderId } = router.query;

  useEffect(() => {
    if (transactionId && orderId) {
      fetch("/api/linepay/confirm-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, orderId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            router.push("/thank-you"); // ✅ 成功跳轉
          } else {
            router.push("/fail"); // ❌ 錯誤跳轉
          }
        })
        .catch(() => {
          router.push("/fail");
        });
    }
  }, [transactionId, orderId]);

  return (
    <div style={{ padding: "100px", textAlign: "center" }}>
      <h1>付款確認中</h1>
      <p>請稍候，我們正在確認您的付款與建立訂單中…</p>
    </div>
  );
}
