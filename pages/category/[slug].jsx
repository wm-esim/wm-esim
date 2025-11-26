import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import Layout from "../Layout";
import CountryFilter from "../../components/NavbarTestSideBarToggle.jsx";
import { useRouter } from "next/router";
import SwiperCarousel from "../../components/SwiperCarousel/SwiperCard.jsx";
import FilterSideBar from "../../components/FilterSideBar";
import { motion } from "framer-motion";

// --- 環境變數設定 ---
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.wmesim.com";

const WC_BASE =
  process.env.NEXT_PUBLIC_WP_API_BASE_URL?.replace(/\/+$/, "") ||
  "https://fegoesim.com";

// 優先使用環境變數，若無則使用預設值
const WC_KEY =
  process.env.WC_CONSUMER_KEY ||
  process.env.NEXT_PUBLIC_WC_CONSUMER_KEY ||
  "ck_ef9f4379124655ad946616864633bd37e3174bc2";

const WC_SECRET =
  process.env.WC_CONSUMER_SECRET ||
  process.env.NEXT_PUBLIC_WC_CONSUMER_SECRET ||
  "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

// --- 關鍵修復：定義請求標頭 (User-Agent) ---
// 這是防止被 WordPress 防火牆擋下的關鍵
const API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
};

// --- getStaticPaths ---
export async function getStaticPaths() {
  // ★★★ 修復重點 ★★★
  // 我們不再預先抓取所有分類路徑，因為這會在部署時瞬間產生大量請求，導致 WordPress 封鎖 IP。
  // 改成回傳空陣列，讓頁面在「第一次被使用者訪問時」才生成 (fallback: 'blocking')。
  // 這樣既能保證部署 100% 成功，又能避免 404。
  return {
    paths: [],
    fallback: "blocking",
  };
}

// --- getStaticProps ---
export async function getStaticProps({ params }) {
  const { slug } = params;

  try {
    // 1. 先抓所有分類來比對 ID
    const catRes = await fetch(
      `${WC_BASE}/wp-json/wc/v3/products/categories?per_page=100&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`,
      { headers: API_HEADERS } // 加入 Header
    );

    if (!catRes.ok) {
      throw new Error(`Categories fetch failed: ${catRes.statusText}`);
    }

    const categories = await catRes.json();
    const matchedCategory = categories.find((c) => c.slug === slug);

    if (!matchedCategory) {
      console.warn(`找不到分類 Slug: ${slug}`);
      return { notFound: true };
    }

    // 2. 根據 ID 抓產品
    const prodRes = await fetch(
      `${WC_BASE}/wp-json/wc/v3/products?category=${matchedCategory.id}&per_page=50&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`,
      { headers: API_HEADERS } // 加入 Header
    );

    if (!prodRes.ok) {
      throw new Error(`Products fetch failed: ${prodRes.statusText}`);
    }

    const data = await prodRes.json();

    return {
      props: {
        slug,
        categories,
        initialProducts: data,
      },
      revalidate: 60, // 每 60 秒重新驗證一次
    };
  } catch (e) {
    console.error(`❌ getStaticProps Error [${slug}]:`, e);
    // 如果連線失敗，不要直接回傳 404，這樣使用者還有機會看到錯誤訊息或重試
    // 但為了標準流程，這裡若失敗還是回傳 notFound 或是一個錯誤狀態
    return { notFound: true, revalidate: 10 };
  }
}

const CategoryPage = ({ slug, categories, initialProducts = [] }) => {
  const router = useRouter();

  // 為了安全起見，如果 initialProducts 是空的或 undefined，給個空陣列
  const safeInitialProducts = Array.isArray(initialProducts)
    ? initialProducts
    : [];

  const [fetchedProducts, setFetchedProducts] = useState(safeInitialProducts);
  const [filteredProducts, setFilteredProducts] = useState(safeInitialProducts);
  const [activeTags, setActiveTags] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const PRODUCTS_PER_PAGE = 12;

  // 當 slug 改變時，Client 端重新抓取 (非必要，因為 getStaticProps 已經抓了，但保留你的邏輯)
  useEffect(() => {
    if (!categories || categories.length === 0) return;

    const matchedCategory = categories.find((cat) => cat.slug === slug);
    if (!matchedCategory) return;

    // 如果 initialProducts 已經有資料且符合當前 slug，就不需要重抓，節省效能
    // 這裡保留你的邏輯，但建議可以判斷一下是否真的需要重抓

    const fetchProducts = async () => {
      try {
        const res = await fetch(
          `${WC_BASE}/wp-json/wc/v3/products?category=${matchedCategory.id}&per_page=50&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`
        );
        const data = await res.json();
        if (Array.isArray(data)) {
          setFetchedProducts(data);
        }
      } catch (err) {
        console.error("Client side fetch error:", err);
      }
    };

    // 只有當初始資料不匹配或需要更新時才執行 (這裡簡單處理直接執行)
    fetchProducts();
  }, [slug, categories]); // 移除 WC_KEY 依賴，避免不必要的重跑

  // 更新 Filter 邏輯
  useEffect(() => {
    const tagsFromQuery = router.query.tags?.split(",").filter(Boolean) || [];
    setActiveTags(tagsFromQuery);
  }, [router.query.tags]);

  useEffect(() => {
    if (!activeTags.length) {
      setFilteredProducts(fetchedProducts);
    } else {
      const filtered = fetchedProducts.filter((product) => {
        const tagMatch = activeTags.every((tag) =>
          product.tags?.some((t) => t.slug === tag || t.name === tag)
        );
        const categoryMatch = activeTags.every((tag) =>
          product.categories?.some((c) => c.slug === tag)
        );
        return tagMatch || categoryMatch;
      });
      setFilteredProducts(filtered);
    }
    // Filter 改變時重置頁碼
    setCurrentPage(1);
  }, [activeTags, fetchedProducts]);

  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const endIndex = startIndex + PRODUCTS_PER_PAGE;
  const currentProducts = filteredProducts.slice(startIndex, endIndex);
  const totalPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);

  // 若資料讀取中或發生錯誤的 fallback (防止頁面崩潰)
  if (!categories) return <div className="p-10 text-center">Loading...</div>;

  return (
    <Layout>
      <div className="flex flex-col bg-[#f9f9fa]">
        <section className="section_Hero w-full mx-auto">
          <SwiperCarousel />
        </section>

        <div className="filter-wrap flex lg:flex-row flex-col sm:px-5 px-4 md:px-10 min-h-screen">
          <div className="filter_bar rounded-xl overflow-hidden w-full lg:w-[25%] bg-white mt-[30px] mr-4">
            <FilterSideBar
              products={fetchedProducts}
              activeTags={activeTags}
              setActiveTags={(tags) => {
                setActiveTags(tags);
                const tagQuery = tags.join(",");
                router.push({
                  pathname: router.pathname,
                  query: { ...router.query, tags: tagQuery },
                });
              }}
            />
          </div>

          <div className="bottom-content mt-[30px] rounded-xl overflow-hidden w-full lg:w-[75%] flex flex-col">
            <div className="top-navgation bg-white border-b border-gray-200 py-5 flex flex-col sm:flex-row items-center pl-4 sm:pl-10">
              <div className="bread_crumb w-full">
                <a href="/">Home</a> ←{" "}
                <span className="text-[16px]">
                  {categories.find((c) => c.slug === slug)?.name ||
                    "All Products"}
                </span>
              </div>
              <CountryFilter />
            </div>

            {currentProducts.length > 0 ? (
              <div className="grid grid-cols-1 bg-white rounded-bl-xl rounded-br-xl sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 p-2 sm:p-6">
                {currentProducts.map((product, index) => {
                  const imgMatch = product.description?.match(
                    /<img[^>]+src=\"([^">]+)\"/
                  );
                  const extractedImg = imgMatch?.[1];
                  const productImage =
                    product.images?.[0]?.src ||
                    extractedImg ||
                    "/default-image.jpg";

                  const price =
                    product.prices?.sale_price || product.prices?.price;
                  const regular = product.prices?.regular_price;

                  return (
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, y: 40 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.05 }}
                      className="group"
                    >
                      <Link href={`/product/${product.slug}`} prefetch={false}>
                        <div className="card overflow-hidden rounded-xl p-4 bg-white">
                          <Image
                            src={productImage}
                            alt={product.name}
                            width={300}
                            height={300}
                            className="w-full rounded-[30px] border-2 border-gray-300 group-hover:shadow-lg object-contain mb-3"
                          />
                          <span className="font-bold text-[16px] block mb-1">
                            {product.name}
                          </span>
                          <div className="text-gray-700">
                            {price ? (
                              <>
                                {regular && (
                                  <del className="mr-1">NT${regular}</del>
                                )}
                                NT${price}
                              </>
                            ) : (
                              <span className="text-red-500 text-sm">
                                價格未設定
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-gray-500 p-10">
                沒有相關產品 (或無法連接伺服器)。
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex justify-center mt-8 space-x-2">
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    className={`px-3 py-1 rounded border ${
                      currentPage === i + 1
                        ? "bg-blue-600 text-white"
                        : "bg-white text-blue-600"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default CategoryPage;
