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

// --- 環境變數 ---
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.wmesim.com";
const WC_BASE =
  process.env.NEXT_PUBLIC_WP_API_BASE_URL?.replace(/\/+$/, "") ||
  "https://fegoesim.com";
const WC_KEY =
  process.env.WC_CONSUMER_KEY ||
  process.env.NEXT_PUBLIC_WC_CONSUMER_KEY ||
  "ck_ef9f4379124655ad946616864633bd37e3174bc2";
const WC_SECRET =
  process.env.WC_CONSUMER_SECRET ||
  process.env.NEXT_PUBLIC_WC_CONSUMER_SECRET ||
  "cs_3da596e08887d9c7ccbf8ee15213f83866c160d4";

// 偽裝 Header
const API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
};

export async function getStaticPaths() {
  // 保持空路徑，避免部署時瞬間併發請求導致被鎖 IP
  return {
    paths: [],
    fallback: "blocking",
  };
}

export async function getStaticProps({ params }) {
  const { slug } = params;

  // 初始化錯誤訊息容器
  let debugInfo = {
    step: "init",
    errorMsg: null,
    fetchedCategories: [],
  };

  try {
    // 1. 抓取分類
    debugInfo.step = "fetching_categories";
    const catRes = await fetch(
      `${WC_BASE}/wp-json/wc/v3/products/categories?per_page=100&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`,
      { headers: API_HEADERS }
    );

    if (!catRes.ok) {
      throw new Error(
        `分類 API 回傳錯誤: ${catRes.status} ${catRes.statusText}`
      );
    }

    const categories = await catRes.json();
    debugInfo.fetchedCategories = categories.map((c) => c.slug); // 紀錄抓到了哪些分類

    const matchedCategory = categories.find((c) => c.slug === slug);

    if (!matchedCategory) {
      // 找不到分類時，不回傳 404，改回傳錯誤訊息以便除錯
      return {
        props: {
          slug,
          categories: [],
          initialProducts: [],
          hasError: true,
          errorMessage: `找不到分類: ${slug}`,
          debugDetails: JSON.stringify(debugInfo),
        },
        revalidate: 10,
      };
    }

    // 2. 抓取產品
    debugInfo.step = "fetching_products";
    const prodRes = await fetch(
      `${WC_BASE}/wp-json/wc/v3/products?category=${matchedCategory.id}&per_page=50&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`,
      { headers: API_HEADERS }
    );

    if (!prodRes.ok) {
      throw new Error(
        `產品 API 回傳錯誤: ${prodRes.status} ${prodRes.statusText}`
      );
    }

    const data = await prodRes.json();

    return {
      props: {
        slug,
        categories,
        initialProducts: data,
        hasError: false,
      },
      revalidate: 60,
    };
  } catch (e) {
    console.error(`❌ getStaticProps 失敗 [${slug}]:`, e);
    // ★★★ 關鍵修改：發生嚴重錯誤時，不回傳 notFound，而是回傳錯誤內容到畫面 ★★★
    return {
      props: {
        slug,
        categories: [],
        initialProducts: [],
        hasError: true,
        errorMessage: e.message || "未知伺服器錯誤",
        debugDetails: JSON.stringify({ ...debugInfo, errorStack: e.stack }),
      },
      revalidate: 10,
    };
  }
}

const CategoryPage = ({
  slug,
  categories,
  initialProducts = [],
  hasError,
  errorMessage,
  debugDetails,
}) => {
  const router = useRouter();
  const [fetchedProducts, setFetchedProducts] = useState(initialProducts || []);
  const [filteredProducts, setFilteredProducts] = useState(
    initialProducts || []
  );
  const [activeTags, setActiveTags] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const PRODUCTS_PER_PAGE = 12;

  // --- ★★★ 錯誤顯示畫面 (除錯用) ★★★ ---
  if (hasError) {
    return (
      <Layout>
        <div className="min-h-screen flex flex-col items-center justify-center p-10 bg-gray-100">
          <div className="bg-white p-8 rounded-xl shadow-lg max-w-2xl w-full border-l-4 border-red-500">
            <h1 className="text-2xl font-bold text-red-600 mb-4">
              系統抓取失敗 (Debug Mode)
            </h1>
            <p className="text-lg font-semibold text-gray-800 mb-2">
              錯誤原因：
            </p>
            <code className="block bg-red-50 p-3 rounded text-red-800 mb-4 font-mono">
              {errorMessage}
            </code>

            <p className="text-sm font-semibold text-gray-600 mb-2">
              詳細診斷資訊：
            </p>
            <pre className="bg-gray-800 text-green-400 p-4 rounded overflow-auto text-xs max-h-60">
              {debugDetails}
            </pre>

            <div className="mt-6 flex gap-4">
              <button
                onClick={() => router.reload()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                重新整理
              </button>
              <Link
                href="/"
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                回首頁
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // --- 正常的 Component 邏輯 ---
  useEffect(() => {
    // 只有當 categories 存在且不為空時才執行
    if (!categories || categories.length === 0) return;

    const matchedCategory = categories.find((cat) => cat.slug === slug);
    if (!matchedCategory) return;

    // 如果 initialProducts 已經有資料，就不一定要重抓，這裡保留你的邏輯
    const fetchProducts = async () => {
      try {
        const res = await fetch(
          `${WC_BASE}/wp-json/wc/v3/products?category=${matchedCategory.id}&per_page=50&consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`
        );
        const data = await res.json();
        setFetchedProducts(data);
      } catch (err) {
        console.error("Client fetch error", err);
      }
    };
    fetchProducts();
  }, [slug, categories]);

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
  }, [activeTags, fetchedProducts]);

  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const endIndex = startIndex + PRODUCTS_PER_PAGE;
  const currentProducts = filteredProducts.slice(startIndex, endIndex);
  const totalPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);

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
                  {categories?.find((c) => c.slug === slug)?.name || slug}
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
                沒有相關產品。
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
