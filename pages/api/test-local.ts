import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import axios from "axios";
import qs from "qs";

const HASH_KEY = "OVB4Xd2HgieiLJJcj5RMx9W94sMKgHQx";
const HASH_IV = "PKetlaZYZcZvlMmC";

function aesEncrypt(data: Record<string, any>): string {
  const payload = qs.stringify(data); // ✅ 這裡就會變成 MerchantID=xxx&Amt=1...
  const cipher = crypto.createCipheriv("aes-256-cbc", HASH_KEY, HASH_IV);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return encrypted.toString("hex");
}

const fakeTradeInfo = {
  MerchantID: "MS3788816305",
  Amt: 1,
  TradeNo: "25080709524041939",
  MerchantOrderNo: "ORDER1754531531343",
  RespondType: "JSON",
  IP: "210.208.97.126",
  EscrowBank: "HNCB",
  ItemDesc: "虛擬商品訂單",
  PaymentType: "CREDIT",
  PayTime: "2025-08-07 09:53:06",
  RespondCode: "00",
  Auth: "031394",
  Card6No: "467450",
  Card4No: "8304",
  Exp: "2711",
  TokenUseStatus: 0,
  InstFirst: 0,
  InstEach: 0,
  Inst: 0,
  ECI: "5",
  PaymentMethod: "CREDIT",
  AuthBank: "LINEBank",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const encryptedTradeInfo = aesEncrypt(fakeTradeInfo);

  try {
    const response = await axios.post("http://localhost:3000/api/newebpay-callback", {
      TradeInfo: encryptedTradeInfo,
    });

    res.status(200).json({
      message: "🔁 測試成功觸發 callback",
      callbackStatus: response.status,
      callbackData: response.data,
    });
  } catch (err: any) {
    console.error("❌ 測試 callback 發生錯誤：", err?.response?.data || err.message);
    res.status(500).json({
      error: "測試失敗",
      detail: err?.response?.data || err.message,
    });
  }
}
