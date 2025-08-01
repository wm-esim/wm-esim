import React, { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { useCart } from "../../components/context/CartContext";
import { useNotification } from "../../components/SlideInNotifications";
import Layout from "../Layout";
import Image from "next/image";
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode, Navigation, Thumbs } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/thumbs";
import PLAN_ID_MAP from "../../lib/esim/planMap";

const extractImageFromDescription = (html) => {
  const match = html?.match(/<img[^>]+src=\"([^">]+)\"/);
  return match?.[1] || null;
};

export async function getStaticPaths() {
  try {
    const res = await fetch(
      `https://fegoesim.com/wp-json/wc/v3/products?consumer_key=ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04&consumer_secret=cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947&per_page=100`
    );
    const products = await res.json();
    const paths = products.map((product) => ({
      params: { slug: product.slug },
    }));
    return { paths, fallback: "blocking" };
  } catch (err) {
    console.error("getStaticPaths 錯誤:", err);
    return { paths: [], fallback: "blocking" };
  }
}

export async function getStaticProps({ params }) {
  const { slug } = params;
  try {
    const res = await fetch(
      `https://fegoesim.com/wp-json/wc/v3/products?slug=${slug}&consumer_key=ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04&consumer_secret=cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947`
    );
    if (!res.ok) return { notFound: true };
    const data = await res.json();
    if (!data || data.length === 0) return { notFound: true };

    console.log(
      "✅ WooCommerce 回傳完整商品：",
      JSON.stringify(data[0], null, 2)
    );

    return {
      props: {
        product: data[0], // ✅ 確保完整傳入，不要自己挑欄位！
      },
      revalidate: 60,
    };
  } catch (err) {
    console.error("getStaticProps 發生例外:", err);
    return { notFound: true };
  }
}

export default function ProductPage({ product }) {
  const { addToCart, toggleCartSidebar } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [thumbsSwiper, setThumbsSwiper] = useState(null);
  const [mainSwiper, setMainSwiper] = useState(null);

  const handleAddToCart = () => {
    console.log("🧪 完整 product 結構：", product);

    const image =
      product.images?.[0]?.src ||
      extractImageFromDescription(product.description) ||
      "/default-image.jpg";

    const cleanedSku = product.sku?.trim().replace(/\u200B/g, "");

    console.log("🧪 原始 SKU:", `"${product.sku}"`);
    console.log(
      "🧪 SKU 字元碼:",
      product.sku?.split("").map((c) => c.charCodeAt(0))
    );
    console.log("🧪 清理後 SKU:", `"${cleanedSku}"`);

    const planId =
      PLAN_ID_MAP[cleanedSku] ||
      product.meta_data?.find((m) => m.key === "esim_plan_id")?.value ||
      null;

    console.log("🧪 對應的 planId:", planId);

    const sku = cleanedSku || "SKU_NOT_FOUND";

    if (sku === "SKU_NOT_FOUND") {
      console.warn("❌ SKU 找不到，請檢查 product 結構", product);
    }

    addToCart({
      id: product.id,
      name: product.name,
      price: product.price,
      sku,
      planId,
      image,
      quantity,
    });

    setTimeout(() => {
      const event = new Event("open-cart-sidebar");
      window.dispatchEvent(event);
    }, 2500);
  };

  const images = product.images?.length
    ? product.images
    : [
        {
          src:
            extractImageFromDescription(product.description) ||
            "/default-image.jpg",
          alt: product.name,
        },
      ];

  return (
    <Layout>
      <Head>
        <title>{product.name}</title>
      </Head>
      <div className="max-w-6xl mx-auto py-20 px-4">
        <div className="flex flex-col py-[100px] lg:flex-row gap-12">
          <div className="w-full lg:w-1/2  flex  lg:flex-row flex-col gap-4 items-start">
            <div className="hidden lg:flex flex-col items-center gap-3 w-[100px]">
              <button
                onClick={() => mainSwiper?.slidePrev()}
                className="w-9 h-9 rounded-full bg-white border border-black flex items-center justify-center hover:bg-gray-100"
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
                watchSlidesProgress={true}
                modules={[FreeMode, Thumbs]}
                className="h-[400px]"
              >
                {images.map((image, index) => (
                  <SwiperSlide key={index}>
                    <div className="w-[80px] h-[80px] relative border rounded overflow-hidden cursor-pointer hover:opacity-80">
                      <Image
                        src={image.src}
                        alt={image.alt || `Thumbnail ${index}`}
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
            <div className="w-full max-w-[400px] aspect-[3/4] relative mx-auto">
              <Swiper
                onSwiper={setMainSwiper}
                loop={true}
                navigation={false}
                thumbs={{ swiper: thumbsSwiper }}
                modules={[FreeMode, Navigation, Thumbs]}
                className="w-full h-full"
              >
                {images.map((image, index) => (
                  <SwiperSlide key={index}>
                    <div className="w-full h-full relative rounded overflow-hidden">
                      <Image
                        src={image.src}
                        alt={image.alt || `Product Image ${index}`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>
            </div>
          </div>

          <div className="w-full lg:w-1/2 flex flex-col justify-start">
            <h1 className="text-2xl font-bold mb-4">{product.name}</h1>
            <p className="text-xl text-gray-800 mb-4">NT${product.price}</p>
            {product.short_description && (
              <div
                className="text-gray-600 mb-6"
                dangerouslySetInnerHTML={{ __html: product.short_description }}
              />
            )}
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-3 py-1 border"
              >
                -
              </button>
              <span>{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-3 py-1 border"
              >
                +
              </button>
            </div>
            <button
              onClick={handleAddToCart}
              className="mt-2 px-6 py-2 bg-[#20a2e3] text-white rounded"
            >
              加入購物車
            </button>
          </div>
        </div>

        <div className="mt-12">
          <h2 className="text-xl font-bold mb-2">商品介紹</h2>
          <div
            className="text-gray-700"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        </div>
      </div>
    </Layout>
  );
}
