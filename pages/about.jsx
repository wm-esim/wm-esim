"use client";
// import styles from "./page.module.scss";
import { useEffect, useState } from "react";
// import { AnimatePresence } from "framer-motion";
// import Preloader from "../components/toys05/Preloader";
import Layout from "./Layout.js";
import Link from "next/link";

// import SidebarNav from "../components/Sidebar.js";
// import Landing from "../components/toys05/Landing";
// import Projects from "../components/toys05/Projects";
// import Description from "../components/toys05/Description";
// import Link from "next/link";
import Example from "../components/Drag/Example.jsx";
// import HeroSlider from "../components/HeroSlider/page";
// import Marquee from "react-fast-marquee";
import Tabs from "../components/ui/Tabs.jsx";
import EmblaCarousel from "../components/EmblaCarouselToys/index.jsx";
import PopupAd from "../components/PopupAd.jsx";
// import Double from "../components/two-colum/Double.jsx";

import SwiperCard from "../components/SwiperCarousel/SwiperCardTravel.jsx";
import SwiperCarouselHero from "../components/SwiperCarouselFood/index.jsx";
// import {
//   Dropdown,
//   DropdownTrigger,
//   DropdownMenu,
//   DropdownItem,
//   Button,
// } from "@nextui-org/react";
import { Typewriter } from "react-simple-typewriter";
import ShiftTime from "../components/ShiftingCountdown/index.jsx";
// import VideoComponent from '../components/VideoComponents/VideoComponent.jsx'
// import SmoothParallaxScroll from "../components/SmoothParallaxScroll/index.js";
import { Parallax } from "react-parallax";
// import SwiperCarousel from "../components/SwiperCarousel/SwiperCardAbout.jsx";
// import SwiperCarousel01 from "../components/SwiperCarousel/SwiperCard.jsx";
// import SwiperCarousel02 from "../components/SwiperCarousel/SwiperCardFood.jsx";
import DragCarousel from "../components/DragCarousel/index.tsx";
// import JsonLd from "../components/JsonLd.jsx";
// import YoutubeUH1 from "../components/VideoPlayer/UH1.jsx";
// import TabMenu from "../components/SVGtext.jsx";
// import ParallaxImage from "../components/ParallaxImage/page.jsx";
// import { ReactLenis } from "@studio-freight/react-lenis";

// import Magnetic from "../../../common/Magnetic";
// import Rounded from "../../../common/RoundedButton";
// import SlidingImages from "../components/toys05/SlidingImages";
// import Contact from "../components/toys05/Contact";
import Image from "next/image";
// import { Link } from "lucide-react";

export default function Home() {
  return (
    <Layout>
      <section className="bg-white  py-[160px] px-6 md:px-12 lg:px-32">
        <div className="max-w-5xl mx-auto space-y-12 text-gray-800">
          {/* 標題區 */}
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-[#191919] mb-4">
              關於汪喵通 SIM
            </h1>
            <p className="text-lg text-gray-600">
              最簡單的 eSIM 出國上網方案，為你省下每一分鐘的旅程時間。
            </p>
          </div>

          {/* 公司理念 */}
          <div>
            <h2 className="text-2xl font-semibold text-left mb-2">
              一站式 eSIM 解決方案，出國上網好簡單
            </h2>
            <p className="text-gray-700 leading-relaxed">
              汪喵通 SIM 提供簡單、快速、便宜的 eSIM
              上網服務，不論是自由行還是商務出差，
              都能找到穩定可靠的跨國上網方案。我們與多家電信商合作，讓你在全球旅途中輕鬆連網，不卡頓、不煩惱。
            </p>
          </div>

          {/* eSIM 說明 */}
          <div>
            <h2 className="text-2xl font-semibold text-left mb-2">
              什麼是 eSIM？為什麼要選擇？
            </h2>
            <p className="text-gray-700 leading-relaxed">
              eSIM 是新一代虛擬 SIM 卡，不需插卡、不用寄送，只要手機支援 eSIM
              功能， 掃描 QR Code
              即可開通。即買即用、無實體卡、不怕遺失，是出國上網的新趨勢。
            </p>
          </div>

          {/* 使用流程 */}
          <div>
            <h2 className="text-2xl font-semibold text-left mb-2">
              購買與使用流程
            </h2>
            <ol className="list-decimal pl-5 text-gray-700 leading-relaxed space-y-1">
              <li>挑選方案：依照國家、天數與用量選擇適合方案</li>
              <li>完成付款：支援信用卡與行動支付</li>
              <li>收到 QR Code：系統自動寄出安裝資訊</li>
              <li>掃描開通：掃碼後立即連網，免設定免等待</li>
            </ol>
          </div>

          {/* 常見問題提醒 */}
          <div>
            <h2 className="text-2xl font-semibold text-left mb-2">
              常見問題與提醒事項
            </h2>
            <ul className="list-disc pl-5 text-gray-700 leading-relaxed space-y-2">
              <li>
                請先確認手機是否支援 eSIM（iPhone XS 以後、Pixel、部分三星）
              </li>
              <li>多數方案掃碼即開始計算天數，請在抵達當地後操作</li>
              <li>eSIM 為一次性使用，刪除後無法再次掃描，請小心保管</li>
              <li>多國方案的速度與流量視地區而定，詳情請見各商品說明</li>
            </ul>
          </div>

          {/* 退換貨政策 */}
          <div>
            <h2 className="text-2xl font-semibold text-left mb-2">
              退換貨與糾紛處理說明
            </h2>
            <p className="text-gray-700 leading-relaxed">
              為保障您的權益，汪喵通 SIM 提供彈性的退費政策：
            </p>
            <ul className="list-disc pl-5 text-gray-700 mt-2 space-y-2">
              <li>未使用、未掃碼者，可於 12 小時內申請取消與退款</li>
              <li>若系統寄錯方案或設備不支援，可提供證明申請退費</li>
              <li>已掃碼啟用、操作錯誤、逾期未申請，恕無法退費</li>
            </ul>
            <p className="text-gray-700 mt-4">
              請於訂單成立後 7 天內透過客服信箱或 LINE
              官方帳號聯繫我們，我們會於 1～2 個工作天內回覆。
            </p>
          </div>

          {/* 聯絡資訊 */}
          <div>
            <h2 className="text-2xl font-semibold text-left mb-2">聯絡我們</h2>
            <ul className="text-gray-700 leading-relaxed">
              <li>
                客服信箱：
                <a
                  className="text-blue-600 underline"
                  href="mailto:service@wangmeowsim.com"
                >
                  service@wangmeowsim.com
                </a>
              </li>
              <li>LINE 客服：搜尋「@wangmeowsim」</li>
              <li>服務時間：週一至週五 10:00～18:00（國定假日除外）</li>
            </ul>
          </div>
        </div>
      </section>
    </Layout>
  );
}
