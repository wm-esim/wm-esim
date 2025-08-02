import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function LinePayConfirmPage() {
  const router = useRouter();
  const { transactionId, amount, orderId } = router.query;

  const [status, setStatus] = useState("確認付款中...");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!router.isReady || !transactionId || !amount || processing) return;

    const confirmAndCallback = async () => {
      setProcessing(true);
      setStatus("✅ 已發送付款確認請求...");

      try {
        // 1. 確認付款
        const res = await fetch("/api/linepay/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId,
            amount: parseInt(amount),
          }),
        });

        const result = await res.json();
        console.log("✅ LINE Pay confirm 回傳結果:", result);

        if (result.returnCode === "0000") {
          setStatus("✅ 付款成功，處理訂單中...");

          // 2. 從 localStorage 取得訂單資料
          const cartItems = JSON.parse(
            localStorage.getItem("cartItems") || "[]"
          );
          const customerEmail = localStorage.getItem("customerEmail") || "";
          const customerName = localStorage.getItem("customerName") || "";

          // 3. 呼叫 callback 建立 Woo 訂單、QRCode、發票
          const callbackRes = await fetch("/api/linepay/linepay-callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transactionId,
              amount: parseInt(amount),
              orderId,
              cartItems,
              customerEmail,
              customerName,
            }),
          });

          const callbackResult = await callbackRes.json();
          console.log("📦 callback 結果:", callbackResult);

          if (callbackRes.ok) {
            setStatus("🎉 訂單完成，eSIM 與發票已寄出！");
            // router.push("/thank-you") 如需跳轉
          } else {
            setStatus("⚠️ 訂單已付款，但處理失敗：" + callbackResult.message);
          }
        } else {
          setStatus(`❌ 付款失敗：${result.returnMessage}`);
        }
      } catch (error) {
        console.error("❌ 發生錯誤:", error);
        setStatus("❌ 付款確認失敗：" + error.message);
      }
    };

    confirmAndCallback();
  }, [router.isReady, transactionId, amount, orderId]);

  return (
    <div className="p-10 text-center text-xl whitespace-pre-line">{status}</div>
  );
}
