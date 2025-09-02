// app/project/page.jsx  或  pages/project.jsx
"use client";

import { useRef, useState, useEffect } from "react";
import Layout from "../Layout";
import Image from "next/image";
import Link from "next/link";
import { BsTelephone, BsChatDots, BsChevronDown } from "react-icons/bs";
import { motion, AnimatePresence } from "framer-motion";

// ✅ Swiper（主圖＋縮圖）
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode, Navigation, Thumbs } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/thumbs";

const Project = () => {
  // 👉 Hero 與圖庫資料
  const hero = {
    image: "/images/project/S__31399939.jpg",
    title: "宜園大院",
    subtitle: "",
    tagline: "",
  };

  // 圖庫
  const gallery = [
    "/images/S__28844100.png",
    "/images/project/S__31399939.jpg",
  ];

  // FAQ
  const faqs = [
    {
      q: "產品規劃與坪數？",
      a: "規劃為連棟透天，建坪約 102–134 坪；實際以建築平面與權狀為準。",
    },
    { q: "社區規模與樓高？", a: "總戶數 15 戶、總樓高 4 層。" },
    { q: "結構與停車規劃？", a: "RC 鋼筋混凝土結構；地下室停車。" },
    { q: "土地使用分區與基地？", a: "土地使用分區為住一，基地面積約 534 坪。" },
    {
      q: "團隊資訊？",
      a: "建設：宜園建設；建築設計：劉偉彥建築師事務所；企劃銷售：晟揮廣告國際有限公司。",
    },
  ];
  const [openIdx, setOpenIdx] = useState(null);

  /* ========= 可選的頁內滾動 ========= */
  const handleScroll = () => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const target = document.querySelector("#next-section");
    const targetY = target
      ? window.scrollY + (target.getBoundingClientRect().top || 0)
      : window.scrollY + window.innerHeight * 0.9;

    if (prefersReduced) {
      window.scrollTo({ top: targetY, behavior: "auto" });
      return;
    }
    const startY = window.scrollY;
    const distance = Math.max(0, targetY - startY);
    const DURATION_MS = 1400;
    const start = performance.now();
    const easeInExpo = (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)));
    const step = (now) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / DURATION_MS);
      const eased = easeInExpo(t);
      window.scrollTo(0, startY + distance * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ========= Lightbox（沿用你原本的） ========= */
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const containerRef = useRef(null);
  const touchStartX = useRef(null);

  const openLightbox = (i) => {
    setSlide(i);
    setLightboxOpen(true);
    document.documentElement.style.overflow = "hidden";
  };
  const closeLightbox = () => {
    setLightboxOpen(false);
    document.documentElement.style.overflow = "";
  };
  const prev = () => setSlide((s) => (s - 1 + gallery.length) % gallery.length);
  const next = () => setSlide((s) => (s + 1) % gallery.length);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) dx > 0 ? prev() : next();
    touchStartX.current = null;
  };

  /* ========= Swiper 主圖/縮圖狀態 ========= */
  const [thumbsSwiper, setThumbsSwiper] = useState(null);
  const [mainSwiper, setMainSwiper] = useState(null);

  return (
    <Layout>
      {/* ============ 建案亮點（左：Gallery Thumbs；右：資訊） ============ */}
      <section className="py-10 sm:py-16 bg-gray-50">
        <div className="w-[95%] max-w-[1200px] mx-auto grid lg:grid-cols-2 grid-cols-1 gap-10 items-start">
          {/* 左側：Gallery（主圖 + 縮圖） */}
          <div className="w-full flex lg:flex-row flex-col gap-4 items-start">
            {/* 垂直縮圖（僅 lg 以上顯示） */}
            <div className="hidden lg:flex flex-col items-center gap-3 w-[100px]">
              <button
                onClick={() => mainSwiper?.slidePrev()}
                className="w-9 h-9 rounded-full bg-white border border-black flex items-center justify-center hover:bg-gray-100"
                aria-label="上一張"
              >
                <svg
                  className="w-4 h-4 text-black"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              </button>

              <Swiper
                onSwiper={setThumbsSwiper}
                direction="vertical"
                spaceBetween={10}
                slidesPerView={4}
                watchSlidesProgress
                modules={[FreeMode, Thumbs]}
                className="h-[400px]"
              >
                {gallery.map((src, index) => (
                  <SwiperSlide key={`thumb-${index}`}>
                    <div className="w-[80px] h-[80px] relative border rounded overflow-hidden cursor-pointer hover:opacity-80">
                      <Image
                        src={src}
                        alt={`縮圖 ${index + 1}`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>

              <button
                onClick={() => mainSwiper?.slideNext()}
                className="w-9 h-9 rounded-full bg-white border border-black flex items-center justify-center hover:bg-gray-100"
                aria-label="下一張"
              >
                <svg
                  className="w-4 h-4 text-black rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              </button>
            </div>

            {/* 主圖 */}
            <div className="w-full max-w-[560px] aspect-[4/3] relative mx-auto">
              <Swiper
                onSwiper={setMainSwiper}
                loop
                navigation={false}
                thumbs={{ swiper: thumbsSwiper }}
                modules={[FreeMode, Navigation, Thumbs]}
                className="w-full h-full"
              >
                {gallery.map((src, index) => (
                  <SwiperSlide key={`main-${index}`}>
                    <button
                      type="button"
                      className="w-full h-full relative rounded overflow-hidden group"
                      onClick={() => openLightbox(index)}
                      aria-label={`查看大圖 ${index + 1}`}
                    >
                      <Image
                        src={src}
                        alt={`主圖 ${index + 1}`}
                        fill
                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    </button>
                  </SwiperSlide>
                ))}
              </Swiper>
            </div>

            {/* 手機：縮圖橫向（可選） */}
            <div className="lg:hidden w-full">
              <Swiper
                onSwiper={setThumbsSwiper}
                spaceBetween={10}
                slidesPerView={4}
                freeMode
                watchSlidesProgress
                modules={[FreeMode, Thumbs]}
                className="mt-3"
              >
                {gallery.map((src, index) => (
                  <SwiperSlide key={`m-thumb-${index}`}>
                    <div className="w-full h-[72px] relative border rounded overflow-hidden cursor-pointer">
                      <Image
                        src={src}
                        alt={`縮圖 ${index + 1}`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>
            </div>
          </div>

          {/* 右側：你提供的建案資訊區塊 */}
          <div id="next-section" className="py-0 sm:py-2">
            <div className="w-full">
              <div className="flex flex-col mb-5">
                <h2 className="text-3xl mb-8">建案名稱：宜園大院</h2>
                <h2 className="text-3xl">建案資訊：</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-10 gap-y-3 text-sm sm:text-base">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">地址</span>
                  <span className="text-gray-900">台中市南屯區大墩南一街</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">產品規劃</span>
                  <span className="text-gray-900">連棟透天</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">總戶數</span>
                  <span className="text-gray-900">15 戶</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">總樓高</span>
                  <span className="text-gray-900">4 層</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">土地使用分區</span>
                  <span className="text-gray-900">住一</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">基地面積</span>
                  <span className="text-gray-900">約 534 坪</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">構造種類</span>
                  <span className="text-gray-900">RC 鋼筋混凝土</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">建坪</span>
                  <span className="text-gray-900">約 102–134 坪</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">車位類別</span>
                  <span className="text-gray-900">地下室停車</span>
                </div>
              </div>

              {/* 品牌／團隊 */}
              <div className="mt-8 flex items-center gap-4">
                <Image
                  src="/images/宜園建設LOGO-1.png"
                  alt="brand-logo"
                  width={120}
                  height={50}
                  className="h-auto w-[120px]"
                />
                <div>
                  <div className="text-sm text-gray-500">團隊資訊</div>
                  <div className="text-base font-medium text-[#20382c]">
                    建設：宜園建設｜
                    <br />
                    建築設計：劉偉彥建築師事務所｜
                    <br />
                    企劃銷售：晟揮廣告國際有限公司
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 圖庫（可點擊開啟 Lightbox） ============ */}
      <section className="py-6 sm:py-12">
        <div className="w-[92%] max-w-[1400px] mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#20382c] mb-6">
            實景 / 圖庫
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {gallery.map((src, i) => (
              <button
                key={src}
                className="relative aspect-[4/3] overflow-hidden rounded-2xl group"
                onClick={() => openLightbox(i)}
                aria-label={`open image ${i + 1}`}
              >
                <Image
                  src={src}
                  alt={`gallery-${i}`}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Lightbox（幻燈片） ===== */}
      <AnimatePresence>
        {lightboxOpen && (
          <motion.div
            ref={containerRef}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-[1px] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
              if (e.target === containerRef.current) closeLightbox();
            }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="relative w-[92%] max-w-[1100px] aspect-[16/10] sm:aspect-[16/9]">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={slide}
                  className="absolute inset-0"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0.2, scale: 1.02 }}
                  transition={{ duration: 0.25 }}
                >
                  <Image
                    src={gallery[slide]}
                    alt={`slide-${slide}`}
                    fill
                    className="object-contain"
                    priority
                  />
                </motion.div>
              </AnimatePresence>

              <button
                onClick={closeLightbox}
                className="absolute -top-10 right-0 sm:top-3 sm:right-3 rounded-full border border-white/30 px-3 py-1.5 text-white/90 text-sm hover:bg-white/10"
                aria-label="close"
              >
                關閉 ✕
              </button>

              <button
                onClick={prev}
                className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="prev"
              >
                ‹
              </button>
              <button
                onClick={next}
                className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="next"
              >
                ›
              </button>

              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                {gallery.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSlide(i)}
                    className={`h-2.5 w-2.5 rounded-full ${
                      i === slide ? "bg-white" : "bg-white/40"
                    }`}
                    aria-label={`go to slide ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ 地段與周邊 ============ */}
      <section className="py-10 sm:py-14 bg-emerald-50/40">
        <div className="w-full max-w-[1400px] mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#20382c]">
            地段與周邊
          </h2>
          <p className="mt-2 text-gray-700">
            座落台中市南屯區大墩南一街，連棟透天產品、戶數精巧，地下室停車，生活圈成熟、交通機能便捷。
          </p>

          <div className="mt-6 grid grid-cols-1">
            <div className="rounded-2xl overflow-hidden border">
              <iframe
                title="map"
                src="https://maps.google.com/maps?q=%E5%8F%B0%E4%B8%AD%E5%B8%82%E5%8D%97%E5%B1%AF%E5%8D%80%E5%A4%A7%E5%A2%A9%E5%8D%97%E4%B8%80%E8%A1%97&t=&z=16&ie=UTF8&iwloc=&output=embed"
                className="w-full h-[320px]"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className="py-10 sm:py-14">
        <div className="w-[92%] max-w-[900px] mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#20382c] mb-4">
            常見問題
          </h2>
          <div className="divide-y rounded-2xl border bg-white">
            {faqs.map((f, idx) => {
              const open = openIdx === idx;
              return (
                <div key={f.q} className="px-5 py-4">
                  <button
                    onClick={() => setOpenIdx(open ? null : idx)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="font-medium">{f.q}</span>
                    <BsChevronDown
                      className={`transition ${open ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.p
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden text-gray-600 pt-2"
                      >
                        {f.a}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ 固定聯絡 CTA ============ */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60]">
        <div className="flex gap-3">
          <Link
            href="tel:0912-345-678"
            className="inline-flex items-center gap-2 rounded-full bg-[#20382c] px-5 py-3 text-white shadow-lg hover:opacity-90 transition"
          >
            <BsTelephone /> 預約看屋
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[#20382c] border shadow hover:bg-emerald-50 transition"
          >
            <BsChatDots /> 線上諮詢
          </Link>
        </div>
      </div>
    </Layout>
  );
};

export default Project;
