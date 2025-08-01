"use client";
import { useState } from "react";
import Layout from "./Layout.js";
import Image from "next/image";

export default function Home() {
  const [popupSrc, setPopupSrc] = useState(null);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 pt-[200px] text-gray-800">
        {/* Popup Overlay */}
        {popupSrc && (
          <div className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center">
            <div className="relative max-w-full max-h-full">
              <button
                className="absolute top-0 bg-[#294dff] flex justify-center items-center rounded-full p-2 h-8 w-8 right-[0px]  text-white text-2xl font-bold z-10"
                onClick={() => setPopupSrc(null)}
              >
                ×
              </button>
              <Image
                src={popupSrc}
                alt="popup"
                width={1000}
                height={1000}
                className="max-w-[90vw] max-h-[90vh] object-contain"
              />
            </div>
          </div>
        )}

        {/* Images with popup trigger */}
        {["step01", "2", "3", "4", "5"].map((name, i) => (
          <Image
            key={i}
            src={`/images/tutorial/${name}.png`}
            alt={`step${i + 1}`}
            className="mx-auto max-w-[650px] mt-8 cursor-pointer"
            width={800}
            height={1000}
            onClick={() => setPopupSrc(`/images/tutorial/${name}.png`)}
          />
        ))}

        <h1 className="text-3xl font-bold mb-6 mt-[100px]">
          eSIM 開通與使用全指南
        </h1>
        <p className="mb-6">
          為確保您順利開通與使用
          eSIM，請務必詳讀以下說明內容。如有任何疑問，請立即聯繫{" "}
          <strong>汪喵通SIM 官方 LINE 客服</strong>，我們將竭誠協助您解決問題。
        </p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            一、開始之前：重要提醒
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>每組 QR Code 僅限一台裝置使用一次。</li>
            <li>eSIM 一經啟用無法刪除重綁，請勿誤操作。</li>
            <li>建議於出國當天、抵達當地後開通以確保正常啟用。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            二、如何安裝 eSIM
          </h2>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong>從「設定」加入：</strong> 設定 → 行動服務 → 加入 eSIM →
              掃描 QR Code。
            </li>
            <li>
              <strong>iOS 17.4 以上：</strong> 存圖至照片 → 相機 APP 開啟相簿 →
              長按 QR Code 圖片加入。
            </li>
            <li>
              <strong>Email 長按加入：</strong> Gmail / Yahoo 信箱中長按 QR Code
              圖片加入。
            </li>
            <li>
              <strong>其他手機掃碼：</strong> 用另一台手機掃描、或列印 QR Code
              再用目標手機掃描。
            </li>
            <li>
              <strong>手動輸入：</strong> 根據信件提供的 SM-DP
              與啟用碼手動設定。
            </li>
          </ol>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            三、eSIM 開通計算與規範
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>QR Code 自發送起 30 日內需啟用，逾期自動失效。</li>
            <li>成功開通當日即為第一天（依台灣時間計算）。</li>
            <li>每組 QR Code 僅綁定一台裝置，請勿重複掃描。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            四、iPhone 開通步驟
          </h2>
          <ol className="list-decimal pl-6 space-y-2">
            <li>設定 → 行動服務 → 加入 eSIM。</li>
            <li>掃描 QR Code 或使用相簿長按加入。</li>
            <li>啟用後命名 eSIM（例：旅遊、日本）。</li>
            <li>預設語音與 iMessage、FaceTime 號碼設為主要。</li>
            <li>抵達後：啟用 eSIM、行動數據、數據漫遊。</li>
            <li>請關閉「允許行動數據切換」。</li>
          </ol>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            五、Android 開通步驟
          </h2>
          <ol className="list-decimal pl-6 space-y-2">
            <li>設定 → 網路與網際網路 → SIM 卡 → 新增 SIM。</li>
            <li>掃描 QR Code 或長按圖片取得 LPA 開頭碼。</li>
            <li>點選「下載」以完成綁定。</li>
            <li>抵達後啟用 eSIM、行動數據與漫遊。</li>
            <li>若無自動 APN，手動設定 softbank / plus.4g。</li>
          </ol>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            六、常見狀況處理
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>顯示「啟用中」：等候 15~45 分鐘或重新開關機。</li>
            <li>顯示「無法啟用」：尚未抵達目的地，屬正常。</li>
            <li>Softbank 用戶：iPhone 自動開通、Android 請手動設 APN。</li>
            <li>泰國與越南方案：請於出國當日再掃碼。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            七、移除 eSIM
          </h2>
          <p className="font-semibold">iPhone：</p>
          <ul className="list-disc pl-6 mb-2">
            <li>設定 → 行動服務 → 關閉與刪除 eSIM。</li>
            <li>返回主畫面 → 確認已無 SIM 資訊。</li>
          </ul>
          <p className="font-semibold">Android：</p>
          <ul className="list-disc pl-6">
            <li>設定 → 網路 → 選擇 eSIM → 停用後刪除。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-left mb-2">
            八、如何確認手機是否支援 eSIM？
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>撥打 *#06#，若有 EID 表示支援。</li>
            <li>或至設定 → 關於本機 → 查詢是否有 eSIM 選項。</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-left mb-2">
            九、流量查詢建議
          </h2>
          <p>
            抵達目的地後，建議於「行動數據設定」中<strong>重設統計資料</strong>
            ， 方便您估算使用量。如需準確流量資訊，請聯繫 LINE 客服。
          </p>
        </section>
      </div>
    </Layout>
  );
}
