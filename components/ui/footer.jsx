import Link from "next/link";
export default function Footer() {
  return (
    <footer className="relative bg-[#222c38] w-full sm:w-[98%] rounded-none sm:rounded-[35px] mx-auto pb-2 pt-10 xl:pt-20 m-0 sm:m-5 sm:pt-[100px]">
      {/* SVG 中間圓弧突起 */}

      {/* Footer內容 */}
      <section className="flex flex-col w-[93%] mx-auto justify-center items-center">
        <h2 className="font-bold text-[32px] lg:text-[50px] text-gray-50">
          準備好開始使用{" "}
          <span className="font-bold text-[32px] lg:text-[50px] text-[#1f34f5]">
            eSIM嗎？
          </span>{" "}
        </h2>
        <p className="text-gray-100 hidden sm:block text-[13px] sm:text-[16px] max-w-[850px] tracking-wider text-center">
          不必插卡、不用等寄送，一掃即用、即刻上網。汪喵通提供多國 eSIM
          資費方案，讓你出國旅遊、商務出差都能隨時連線不中斷。手機支援就能安裝，3
          分鐘快速啟用，無需繁瑣設定。立即選擇適合你的國家方案，體驗真正無卡、無限的行動自由。
        </p>
      </section>
      <div className="relative z-10 px-6 pb-14 py-4 xl:py-20 text-white text-center">
        <div>
          <div className="left w-1/2"></div>
          <div className="right w-1/2"></div>
        </div>
        <Link href="/about" className="text-lg  border-b-1  font-semibold">
          {" "}
          汪喵通SIM
        </Link>
        <p className="text-sm text-center text-gray-400">
          Web Design & System Development by{" "}
          <a
            href="https://www.jeek-webdesign.com.tw"
            target="_blank"
            className="underline hover:text-white"
          >
            極客網頁設計
          </a>{" "}
          版權所有 © {new Date().getFullYear()}。
        </p>
      </div>
    </footer>
  );
}
