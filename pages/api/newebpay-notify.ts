import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";

// 🔐 藍新金鑰
const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

// 🔗 WooCommerce API
const WOOCOMMERCE_API_URL =
  "https://fegoesim.com/wp-json/wc/v3/orders";
const CONSUMER_KEY = "ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04";
const CONSUMER_SECRET = "cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947";

// 🌐 eSIM Proxy API
const ESIM_PROXY_URL =
  "https://www.wmesim.com/api/esim/qrcode";

// 🔓 解密藍新金流 TradeInfo
function aesDecrypt(encryptedText: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8")
  );
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  // ✅ 印出收到的原始 callback 資料（給 Vercel Logs 用）
  console.log("📥 Callback 來的資料：", JSON.stringify(req.body, null, 2));

  const { TradeInfo } = req.body;

  try {
    const decrypted = aesDecrypt(TradeInfo, HASH_KEY, HASH_IV);
    console.log("🔥 Raw decrypted:", decrypted);

    const parsed = new URLSearchParams(decrypted);
    const result: Record<string, string> = {};
    parsed.forEach((value, key) => {
      result[key] = value;
    });

    console.log("✅ 解析結果：", result);

    if (result.Status !== "SUCCESS") {
      console.log("⚠️ 非成功交易，不更新 WooCommerce 訂單");
      return res.status(200).send("SKIP");
    }

    const orderNumber = result.MerchantOrderNo;
    if (!orderNumber) throw new Error("❌ 缺少 MerchantOrderNo");

    // 🔍 查詢 WooCommerce 訂單
    const { data: orders } = await axios.get(WOOCOMMERCE_API_URL, {
      auth: {
        username: CONSUMER_KEY,
        password: CONSUMER_SECRET,
      },
      params: {
        per_page: 10,
        orderby: "date",
        order: "desc",
      },
    });

    const order = orders.find(
      (o: any) => String(o.number) === orderNumber
    );

    if (!order) {
      console.error("❌ 找不到 WooCommerce 訂單");
      return res.status(404).send("NOT FOUND");
    }

    const orderId = order.id;

    // 📡 呼叫 eSIM 服務
// ✅ 從訂單中抓出 esim_plan_id 和 esim_quantity
const planIdMeta = order.meta_data.find((m: any) => m.key === "esim_plan_id");
const quantityMeta = order.meta_data.find((m: any) => m.key === "esim_quantity");

const planId = planIdMeta?.value;
const quantity = parseInt(quantityMeta?.value || "1");

if (!planId || !quantity) {
  throw new Error("❌ 訂單中缺少 eSIM 方案資訊");
}

// 📡 呼叫 /api/esim/qrcode
const esimRes = await axios.post(ESIM_PROXY_URL, {
  planId,
  quantity,
});


    const esim = esimRes.data;

    if (!esim?.qrcode) {
      throw new Error("eSIM proxy 回傳缺少 QRCode");
    }

    const qrcodeRaw = String(esim.qrcode || "");
    const qrcodeImage = qrcodeRaw.startsWith("data:image")
      ? qrcodeRaw
      : `data:image/png;base64,${qrcodeRaw}`;

    // ✍️ 寫入 WooCommerce 訂單 Meta
   // ✍️ 寫入 WooCommerce 訂單 Meta
await axios.put(
  `${WOOCOMMERCE_API_URL}/${orderId}`,
  {
    status: "processing",
    meta_data: [
      { key: "esim_qrcode", value: qrcodeImage },
      { key: "esim_topup_id", value: esim.topup_id },
      { key: "esim_plan_id", value: planId },
      { key: "esim_quantity", value: quantity },
    ],
  },
  {
    auth: {
      username: CONSUMER_KEY,
      password: CONSUMER_SECRET,
    },
  }
);


    // 📝 寫入訂單備註（讓客戶看得到）
    try {
      await axios.post(
        `${WOOCOMMERCE_API_URL}/${orderId}/notes`,
        {
          note: `<strong>eSIM QRCode：</strong><br /><img src="${qrcodeImage}" style="max-width:200px;" />`,
          customer_note: true,
        },
        {
          auth: {
            username: CONSUMER_KEY,
            password: CONSUMER_SECRET,
          },
        }
      );
      console.log("✅ 備註已寫入");
    } catch (err: any) {
      console.error("❌ 寫入備註失敗:", err.response?.data || err.message);
    }

    console.log(`🎉 訂單 ${orderNumber}（ID: ${orderId}）已更新 QRCode`);
    res.status(200).send("OK");
  } catch (error: any) {
    console.error("❌ Notify 處理錯誤：", error.message);
    res.status(400).send("FAIL");
  }
}
