// pages/category/[slug].js

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { motion } from "framer-motion";

import Layout from "../Layout";
import CountryFilter from "../../components/NavbarTestSideBarToggle.jsx";
import SwiperCarousel from "../../components/SwiperCarousel/SwiperCard.jsx";
import FilterSideBar from "../../components/FilterSideBar";

// ✅ Woo endpoints（server-side 會直接打 WP，不依賴本站網址）
const WC_CATEGORIES_ENDPOINT = "wc/v3/products/categories";
const WC_PRODUCTS_ENDPOINT = "wc/v3/products";

// ✅ 保證永遠是 array
const toArray = (v) => (Array.isArray(v) ? v : []);

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${text.slice(0, 300)}`);
  }
}

// ✅ server-side 用：直接打 Woo API（用 env key/secret）
async function fetchWooServer(endpoint, queryObj = {}) {
  const base = process.env.WC_BASE_URL;
  const ck = process.env.WC_CONSUMER_KEY;
  const cs = process.env.WC_CONSUMER_SECRET;

  if (!base || !ck || !cs) {
    throw new Error(
      "Missing env: WC_BASE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET"
    );
  }

  const url = new URL(`${base}/wp-json/${endpoint}`);
  url.searchParams.set("consumer_key", ck);
  url.searchParams.set("consumer_secret", cs);

  for (const [k, v] of Object.entries(queryObj)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  return fetchJson(url.toString());
}

export async function getStaticPaths() {
  try {
    const categories = await fetchWooServer(WC_CATEGORIES_ENDPOINT, {
      per_page: 100,
    });

    const paths = toArray(categories)
      .filter((c) => c?.slug)
      .map((cat) => ({ params: { slug: cat.slug } }));

    return { paths, fallback: "blocking" };
  } catch (e) {
    console.error("❌ getStaticPaths error:", e);
    // categories 抓不到也不要整站炸掉
    return { paths: [], fallback: "blocking" };
  }
}

export async function getStaticProps({ params }) {
  const slug = params?.slug;

  try {
    const categories = await fetchWooServer(WC_CATEGORIES_ENDPOINT, {
      per_page: 100,
    });

    const categoriesArr = toArray(categories);
    const matchedCategory = categoriesArr.find((cat) => cat.slug === slug);

    if (!matchedCategory) {
      // ✅ notFound 也要 revalidate（避免永久快取 404）
      return { notFound: true, revalidate: 10 };
    }

    const products = await fetchWooServer(WC_PRODUCTS_ENDPOINT, {
      category: matchedCategory.id,
      per_page: 100,
    });

    return {
      props: {
        slug,
        categories: categoriesArr,
        initialProducts: toArray(products),
      },
      revalidate: 10,
    };
  } catch (e) {
    console.error("❌ getStaticProps error:", e);
    return { notFound: true, revalidate: 10 };
  }
}

export default function CategoryPage({
  slug,
  categories = [],
  initialProducts = [],
}) {
  const router = useRouter();

  const [fetchedProducts, setFetchedProducts] = useState(
    toArray(initialProducts)
  );
  const [filteredProducts, setFilteredProducts] = useState(
    toArray(initialProducts)
  );
  const [activeTags, setActiveTags] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  const PRODUCTS_PER_PAGE = 12;

  const matchedCategory = useMemo(
    () => toArray(categories).find((cat) => cat.slug === slug),
    [categories, slug]
  );

  // ✅ client 端用 /api/wc（不暴露 secret）
  useEffect(() => {
    if (!matchedCategory?.id) {
      setFetchedProducts([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = await fetchJson(
          `/api/wc?endpoint=${WC_PRODUCTS_ENDPOINT}&query=${encodeURIComponent(
            `category=${matchedCategory.id}&per_page=100`
          )}`
        );
        if (!cancelled) setFetchedProducts(toArray(data));
      } catch (err) {
        console.error("抓分類產品失敗", err);
        if (!cancelled) setFetchedProducts([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [matchedCategory?.id]);

  // 讀取 query tags
  useEffect(() => {
    const tagsFromQuery =
      router.query.tags?.toString().split(",").filter(Boolean) || [];
    setActiveTags(tagsFromQuery);
    setCurrentPage(1);
  }, [router.query.tags]);

  // 套用 tag filter
  useEffect(() => {
    const base = toArray(fetchedProducts);

    if (!activeTags || activeTags.length === 0) {
      setFilteredProducts(base);
      return;
    }

    const filtered = base.filter((product) => {
      const tagMatch = activeTags.every((tag) =>
        product.tags?.some((t) => t.slug === tag || t.name === tag)
      );
      const categoryMatch = activeTags.every((tag) =>
        product.categories?.some((cat) => cat.slug === tag)
      );
      return tagMatch || categoryMatch;
    });

    setFilteredProducts(toArray(filtered));
  }, [activeTags, fetchedProducts]);

  const safeFilteredProducts = toArray(filteredProducts);
  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const endIndex = startIndex + PRODUCTS_PER_PAGE;
  const currentProducts = safeFilteredProducts.slice(startIndex, endIndex);
  const totalPages = Math.ceil(safeFilteredProducts.length / PRODUCTS_PER_PAGE);

  const title =
    toArray(categories).find((cat) => cat.slug === slug)?.name ||
    "All Products";

  return (
    <Layout>
      <div className="flex flex-col bg-[#f9f9fa]">
        <section className="section_Hero w-full mx-auto">
          <SwiperCarousel />
        </section>

        <div className="filter-wrap flex lg:flex-row flex-col sm:px-5 px-4 md:px-10 min-h-screen">
          <div className="filter_bar rounded-xl overflow-hidden w-full lg:w-[25%] bg-white mt-[30px] mr-4">
            <FilterSideBar
              products={toArray(fetchedProducts)}
              activeTags={activeTags}
              setActiveTags={(tags) => {
                setActiveTags(tags);
                const tagQuery = tags.join(",");
                router.push(
                  {
                    pathname: router.pathname,
                    query: { ...router.query, tags: tagQuery },
                  },
                  undefined,
                  { shallow: true }
                );
              }}
            />
          </div>

          <div className="bottom-content mt-[30px] rounded-xl overflow-hidden w-full lg:w-[75%] flex flex-col">
            <div className="top-navgation bg-white max-w-[1920px] border-b border-gray-200 py-5 flex flex-col sm:flex-row items-center pl-4 sm:pl-10">
              <div className="bread_crumb w-full">
                <a href="/">Home</a> ←{" "}
                <span className="text-[16px]">{title}</span>
              </div>
              <CountryFilter />
            </div>

            {currentProducts.length > 0 ? (
              <div className="grid grid-cols-1 bg-white rounded-bl-xl rounded-br-xl sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 p-2 sm:p-6">
                {currentProducts.map((product, index) => {
                  const match = product?.description?.match(
                    /<img[^>]+src="([^">]+)"/
                  );
                  const extractedImg = match?.[1];
                  const productImage =
                    product?.images?.[0]?.src ||
                    extractedImg ||
                    "/default-image.jpg";

                  const price =
                    product?.prices?.sale_price ||
                    product?.prices?.price ||
                    product?.sale_price ||
                    product?.price ||
                    null;

                  const regularPrice =
                    product?.prices?.regular_price ||
                    product?.regular_price ||
                    null;

                  return (
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, y: 40 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.05 }}
                      className="group"
                    >
                      <Link
                        href={`/product/${product.slug}`}
                        prefetch={false}
                        className="hover:scale-105 duration-200 block"
                      >
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
                                {regularPrice && (
                                  <del className="mr-1">NT${regularPrice}</del>
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
}
