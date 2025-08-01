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

const CATEGORY_API_URL = `https://fegoesim.com/wp-json/wc/v3/products/categories?consumer_key=ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04&consumer_secret=cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947&per_page=100`;

export async function getStaticPaths() {
  const categoryRes = await fetch(CATEGORY_API_URL);
  const categories = await categoryRes.json();

  const paths = categories.map((cat) => ({
    params: { slug: cat.slug },
  }));

  return { paths, fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  try {
    const categoryRes = await fetch(CATEGORY_API_URL);
    const categories = await categoryRes.json();

    const matchedCategory = categories.find((cat) => cat.slug === params.slug);
    if (!matchedCategory) return { notFound: true };

    const productRes = await fetch(
      `https://fegoesim.com/wp-json/wc/v3/products?category=${matchedCategory.id}&consumer_key=...&consumer_secret=...`
    );
    const data = await productRes.json();

    return {
      props: {
        slug: params.slug,
        categories,
        initialProducts: data,
      },
      revalidate: 10,
    };
  } catch (e) {
    console.error("❌ ISR 錯誤：", e);
    return { notFound: true };
  }
}

const CategoryPage = ({ slug, categories }) => {
  const router = useRouter();
  const [fetchedProducts, setFetchedProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [activeTags, setActiveTags] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const PRODUCTS_PER_PAGE = 12;

  useEffect(() => {
    const matchedCategory = categories.find((cat) => cat.slug === slug);
    if (!matchedCategory) {
      setFetchedProducts([]);
      return;
    }

    const fetchProducts = async () => {
      try {
        const res = await fetch(
          `https://fegoesim.com/wp-json/wc/v3/products?category=${matchedCategory.id}&consumer_key=ck_0ed8acaab9f0bc4cd27c71c2e7ae9ccc3ca45b04&consumer_secret=cs_50ad8ba137c027d45615b0f6dc2d2d7ffcf97947`
        );
        const data = await res.json();
        setFetchedProducts(data);
      } catch (err) {
        console.error("抓分類產品失敗", err);
        setFetchedProducts([]);
      }
    };

    fetchProducts();
  }, [slug, categories]);

  useEffect(() => {
    const tagsFromQuery = router.query.tags?.split(",").filter(Boolean) || [];
    setActiveTags(tagsFromQuery);
  }, [router.query.tags]);

  useEffect(() => {
    if (!activeTags || activeTags.length === 0) {
      setFilteredProducts(fetchedProducts);
    } else {
      const filtered = fetchedProducts.filter((product) => {
        const tagMatch = activeTags.every((tag) =>
          product.tags?.some((t) => t.slug === tag || t.name === tag)
        );
        const categoryMatch = activeTags.every((tag) =>
          product.categories?.some((cat) => cat.slug === tag)
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
            <div className="top-navgation bg-white max-w-[1920px]  border-b border-gray-200 py-5 flex flex-col sm:flex-row items-center pl-4 sm:pl-10">
              <div className="bread_crumb w-full">
                <a href="/">Home</a> ←{" "}
                <span className="text-[16px]">
                  {categories.find((cat) => cat.slug === slug)?.name ||
                    "All Products"}
                </span>
              </div>
              <CountryFilter />
            </div>

            {currentProducts.length > 0 ? (
              <div className="grid grid-cols-1 bg-white rounded-bl-xl rounded-br-xl sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 p-2 sm:p-6">
                {currentProducts.map((product, index) => {
                  const match = product?.description?.match(
                    /<img[^>]+src=\"([^">]+)\"/
                  );
                  const extractedImg = match?.[1];
                  const productImage =
                    product?.images?.[0]?.src ||
                    extractedImg ||
                    "/default-image.jpg";

                  const price =
                    product?.prices?.sale_price ||
                    product?.prices?.price ||
                    null;
                  const regularPrice = product?.prices?.regular_price || null;

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
};

export default CategoryPage;
