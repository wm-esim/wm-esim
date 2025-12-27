// app/components/SlideTabsExample.jsx
"use client";

import { useUser } from "../../components/context/UserContext";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import MenuToggle from "../../components/Header/index";
import { useRouter } from "next/router";

export const SlideTabsExample = () => {
  const router = useRouter();

  // Mobile 選單與滾動狀態
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuActive, setIsMenuActive] = useState(false); // 保留給桌機 navbar 動畫用
  const [isScrollingUp, setIsScrollingUp] = useState(true);
  const lastScrollY = useRef(0);

  // 使用者狀態
  const { userInfo, isHydrated, logout } = useUser();

  const navLinks = [
    { label: "日本", href: "/category/japan/" },
    { label: "韓國", href: "/category/korea/" },
    { label: "中國", href: "/category/china/" },
    { label: "東南亞", href: "/category/malaysia/" },
    { label: "歐美", href: "/category/america/" },
    { label: "兌換QRcode", href: "/shopee-qrcode" },
  ];

  /* ============== 滾動方向（桌機 navbar 顯示/隱藏） ============== */
  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY < 0) return;
      if (currentY > lastScrollY.current && currentY > 50) {
        setIsScrollingUp(false);
      } else {
        setIsScrollingUp(true);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /* ============== 手機選單開關：鎖定背景捲動 ============== */
  useEffect(() => {
    if (isMenuOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isMenuOpen]);

  // 同步 isMenuActive（保留你原本的桌機 navbar 動畫控制）
  useEffect(() => {
    setIsMenuActive(isMenuOpen);
  }, [isMenuOpen]);

  // 登出
  const handleLogout = () => {
    logout?.();
    router.push("/");
  };

  return (
    <>
      {/* =================== 桌機版 Navbar（照舊） =================== */}
      <AnimatePresence mode="wait">
        {!isMenuActive && (
          <motion.div
            key="navbar"
            initial={{ opacity: 0, y: -10 }}
            animate={{
              opacity: isScrollingUp ? 1 : 0,
              y: isScrollingUp ? 0 : -20,
            }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4 }}
            className="fixed left-0 w-full top-6 z-[1200]"
          >
            <div className="flex justify-between items-center px-5 !rounded-[8px] bg-white py-[9.5px] mx-auto w-[96.5%] md:py-[9.5px]">
              {/* Logo */}
              <div className="w-[20%] pl-5">
                <Link href="/">
                  <div className="w-[40px]">
                    <Image
                      src="/images/logo/logo.svg"
                      alt="ESIM Logo"
                      width={120}
                      height={40}
                      priority
                    />
                  </div>
                </Link>
              </div>

              {/* Desktop Nav */}
              <div className="hidden md:flex w-[60%] justify-center gap-6 items-center">
                {navLinks.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="group hover:bg-[#4badf4] relative h-10 rounded-full bg-transparent px-4 text-neutral-950"
                  >
                    <span className="relative inline-flex overflow-hidden">
                      <div className="translate-y-0 mt-2 text-slate-500 transition duration-500 group-hover:-translate-y-[150%] group-hover:skew-y-12">
                        {link.label}
                      </div>
                      <div className="absolute translate-y-[110%] mt-2 group-hover:text-white transition duration-500 group-hover:translate-y-0 group-hover:skew-y-0">
                        {link.label}
                      </div>
                    </span>
                  </Link>
                ))}
              </div>

              {/* Right Side Icons */}
              <div className="w-[80%] md:w-[20%]">
                <div className="hidden md:flex items-center justify-center gap-4">
                  {/* Cart */}
                  <Link href="/Cart">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Cart</span>
                      <img
                        src="/images/shopping-cart.png"
                        alt="cart-icon"
                        className="w-[24px] h-[24px]"
                      />
                    </div>
                  </Link>

                  {/* Desktop User Info */}
                  {!isHydrated ? (
                    <div className="w-[140px] h-[24px] rounded bg-black/5 animate-pulse" />
                  ) : userInfo ? (
                    <>
                      <Link href="/account" className="flex items-center gap-2">
                        <span className="text-sm">Hello, {userInfo.name}</span>
                        <img
                          src="/images/250721.jpg"
                          alt="account-icon"
                          className="w-[24px] h-[24px]"
                        />
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="hover:opacity-80 transition"
                        title="登出"
                      >
                        <img
                          src="/images/Nav/Logout--Streamline-Outlined-Material-Symbols.svg"
                          alt="logout-icon"
                          className="w-[24px] h-[24px]"
                        />
                      </button>
                    </>
                  ) : (
                    <Link href="/login" className="flex items-center gap-2">
                      <span className="text-sm">登入 / Account</span>
                      <img
                        src="/images/0721_0.jpg"
                        alt="account-icon"
                        className="w-[24px] h-[24px]"
                      />
                    </Link>
                  )}
                </div>
              </div>

              <div className="w-[20%] md:hidden"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =================== 手機版 Header（左 Logo / 右 漢堡） =================== */}
      <div
        className="
          md:hidden
          fixed inset-x-0 top-0
          z-[2147483646]
          bg-white/90 backdrop-blur
          border-b border-black/5
        "
      >
        <div
          className="
            flex items-center justify-between
            px-4
            pt-[calc(env(safe-area-inset-top,0px)+8px)]
            pb-2
          "
        >
          {/* 右：漢堡（沿用你的 MenuToggle，直接綁 isMenuOpen） */}
          <div className="shrink-0">
            <MenuToggle
              isActive={isMenuOpen}
              setIsActive={(next) => {
                setIsMenuOpen(next);
                setIsMenuActive(next); // 同步，避免桌機 navbar 動畫搶到
              }}
            />
          </div>
        </div>
      </div>

      {/* 手機版：Header 佔位（避免內容被遮住） */}
      <div className="md:hidden h-[calc(env(safe-area-inset-top,0px)+56px)]" />

      {/* =================== 手機選單背景遮罩 =================== */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className="fixed inset-0 z-[2147483645] pointer-events-none md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="w-full h-full bg-black/25 backdrop-blur-sm pointer-events-auto" />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
