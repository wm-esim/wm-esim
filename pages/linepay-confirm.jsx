import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function LinePayConfirmPage() {
  const router = useRouter();
  const { transactionId, amount, orderId } = router.query;
  const [status, setStatus] = useState("確認付款中...");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!router.isReady || !transactionId || !amount || processing) return;

    console.log("🔁 router.query ready");
    console.log("📦 transactionId:", transactionId);
    console.log("💰 amount:", amount);

    const confirmPayment = async () => {
      setProcessing(true);
      try {
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
          setStatus("✅ 付款成功，訂單處理中...");
        } else {
          setStatus(`❌ 付款失敗：${result.returnMessage}`);
        }
      } catch (error) {
        console.error("❌ 發送確認付款請求時出錯:", error);
        setStatus("❌ 確認付款過程發生錯誤");
      }
    };

    confirmPayment();
  }, [router.isReady, transactionId, amount]);

  return <div className="p-10 text-center text-xl">{status}</div>;
}
