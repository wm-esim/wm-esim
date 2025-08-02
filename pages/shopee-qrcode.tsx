import { useState } from "react";

export default function ShopeeQRCodePage() {
  const [orderNo, setOrderNo] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("http://localhost:3000/api/shopee-to-esim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopee_order_no: orderNo, email }),
      });

      const data = await res.json();

      if (data?.alreadyRedeemed) {
        setMessage(
          "\u26a0\ufe0f \u6b64\u8a02\u55ae\u5df2\u5b8c\u6210\u514c\u63db\uff0c\u7121\u9700\u518d\u6b21\u63d0\u4ea4\u3002\u5982\u6709\u554f\u984c\u8acb\u806f\u7d61\u6211\u5011"
        );
      } else if (data?.success) {
        setMessage(
          "\u2705 \u5df2\u6210\u529f\u7522\u751f QRCode \u4e26\u5bc4\u9001\u81f3\u4fe1\u7bb1\uff01"
        );
      } else {
        setMessage(
          `\u274c \u767c\u751f\u932f\u8aa4\uff1a${
            data?.error || data?.message || "\u8acb\u7a0d\u5f8c\u518d\u8a66"
          }`
        );
      }
    } catch (error) {
      setMessage(
        "\u274c \u7cfb\u7d71\u932f\u8aa4\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002"
      );
    }

    setLoading(false);
  };

  return (
    <div className="flex bg-[#ededed] py-[100px] lg:py-0 h-auto lg:h-screen justify-center items-center">
      <div className="flex max-w-[1000px] flex-col lg:flex-row w-[80%] mx-auto">
        <div className="w-full lg:w-[60%] p-[60px] mx-2 mt-10 border border-gray-300 rounded-lg shadow-md bg-[#4286f3]">
          <h1 className="text-2xl font-bold mb-8 text-white text-center">
            eSIM 蝦皮訂單兌換
          </h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-medium mb-1 text-gray-100">
                蝦皮訂單編號
              </label>
              <input
                type="text"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                className="w-full border p-2 rounded-[12px]"
                placeholder="例如：SP123456789"
                required
              />
            </div>

            <div>
              <label className="block font-medium mb-1 text-gray-100">
                收件信箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border p-2 rounded-[12px]"
                placeholder="若留空則使用訂單信箱"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-100 text-gray-800 rounded-[12px] py-2 hover:bg-gray-300 transition"
            >
              {loading ? "處理中..." : "產生 QRCode 並寄送"}
            </button>
          </form>

          <div className="w-2/3 mx-auto">
            {message && (
              <p className="mt-6 text-center font-medium text-gray-800 whitespace-pre-wrap">
                {message}
              </p>
            )}
          </div>
        </div>
        <div className="w-full lg:w-[40%] mx-auto p-6 mt-10 rounded-lg shadow-md bg-white">
          <div>
            <h2>INFO</h2>
            <div>
              <p>
                提供蝦皮訂單購買的 eSIM
                商品進行兌換使用。請輸入您的蝦皮訂單編號與有效的收件信箱，我們將會產生對應的
                eSIM QRCode 並寄送至您的信箱。
              </p>
            </div>
            <div className="py-3">
              <ul className="list-disc pl-5 space-y-2 text-gray-700">
                <li>
                  <strong>蝦皮訂單編號：</strong>
                  <ul className="list-disc pl-5">
                    <li>請填寫完整訂單編號（例如：SP123456789）</li>
                    <li>可在蝦皮訂單詳情頁面中查詢</li>
                  </ul>
                </li>
                <li>
                  <strong>收件信箱：</strong>
                  <ul className="list-disc pl-5">
                    <li>請填寫您方便接收 QRCode 的電子郵件</li>
                    <li>若留空，系統將使用您下單時提供的信箱（若有）</li>
                  </ul>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-sm">
                每筆訂單僅能兌換一次，若系統偵測此訂單已產生過
                QRCode，將不會重複處理與寄信。 如有問題請聯絡我們
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
