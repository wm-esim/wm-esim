// pages/blog/[slug].jsx
import Head from "next/head";
import { useRouter } from "next/router";
import parse from "html-react-parser";
import dynamic from "next/dynamic";
import Layout from "../Layout";

const OtherPostsCarousel = dynamic(() =>
  import("../../components/OtherPostsCarousel")
);

/* ---------- ENV & helpers ---------- */
// 站點
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.wmesim.com";

// WP API base（支援 WP_API_BASE_URL 或 NEXT_PUBLIC_WP_API_BASE_URL；自動補 /wp-json）
const WP_BASE_RAW =
  process.env.WP_API_BASE_URL ||
  process.env.NEXT_PUBLIC_WP_API_BASE_URL ||
  "https://fegoesim.com";
const WP_BASE = WP_BASE_RAW.replace(/\/+$/, "");

// 產生 WP REST URL
const wp = (p) => `${WP_BASE}/wp-json${p}`;

// 取代貼文中跨網域資源到本站網域（如果需要）
const swapToSite = (url = "") =>
  typeof url === "string" ? url.replace(/^https?:\/\/[^/]+/i, SITE_URL) : url;

/* ---------- Page ---------- */
export default function PostPage({ post, relatedPosts = [] }) {
  const router = useRouter();
  if (router.isFallback) return <div>Loading...</div>;
  if (!post) return <div>Not Found</div>;

  const seo = post.yoast_head_json || {};
  const canonicalUrl = seo?.canonical?.startsWith("http")
    ? seo.canonical
    : `${SITE_URL}/blog/${post.slug}`;
  const ogUrl = seo?.og_url || canonicalUrl;

  // 取得文內第一張圖做 og:image
  const firstImageMatch = post.content?.rendered?.match(
    /<img[^>]+src="([^">]+)"/
  );
  const firstImage = swapToSite(firstImageMatch?.[1]) || `${SITE_URL}/logo.png`;

  const fallbackDescription =
    post.excerpt?.rendered?.replace(/<[^>]+>/g, "")?.slice(0, 160) ||
    "台灣 eSIM、免簽、自由行教學與最新旅遊資訊";
  const fallbackKeywords = `${post.title.rendered}, eSIM, 台灣eSIM, 旅遊上網, 日本旅遊, 自由行, 簽證, 2025`;

  const renderContent = (html) =>
    parse(html || "", {
      replace: (node) => {
        if (node?.type === "tag" && node.name === "img" && node.attribs?.src) {
          const src = swapToSite(node.attribs.src);
          return (
            <img
              src={src}
              alt={node.attribs.alt || ""}
              loading="lazy"
              style={{ width: "100%", height: "auto" }}
            />
          );
        }
      },
    });

  return (
    <>
      <Layout>
        <Head>
          <title>{seo?.title || `${post.title.rendered}｜部落格文章`}</title>
          <meta
            name="description"
            content={seo?.description || fallbackDescription}
          />
          <meta name="keywords" content={fallbackKeywords} />
          <link rel="canonical" href={canonicalUrl} />

          {seo?.robots && (
            <>
              <meta
                name="robots"
                content={`${seo.robots.index}, ${seo.robots.follow}`}
              />
              {"max-snippet" in seo.robots && (
                <meta name="max-snippet" content={seo.robots["max-snippet"]} />
              )}
              {"max-image-preview" in seo.robots && (
                <meta
                  name="max-image-preview"
                  content={seo.robots["max-image-preview"]}
                />
              )}
              {"max-video-preview" in seo.robots && (
                <meta
                  name="max-video-preview"
                  content={seo.robots["max-video-preview"]}
                />
              )}
            </>
          )}

          <meta
            property="og:title"
            content={seo?.og_title || post.title.rendered}
          />
          <meta
            property="og:description"
            content={seo?.og_description || fallbackDescription}
          />
          <meta property="og:type" content={seo?.og_type || "article"} />
          <meta property="og:url" content={ogUrl} />
          <meta
            property="og:site_name"
            content={seo?.og_site_name || "wmesim"}
          />
          <meta property="og:locale" content={seo?.og_locale || "zh_TW"} />
          <meta property="og:image" content={firstImage} />

          <meta
            name="twitter:card"
            content={seo?.twitter_card || "summary_large_image"}
          />
          <meta
            name="twitter:title"
            content={seo?.twitter_title || post.title.rendered}
          />
          <meta
            name="twitter:description"
            content={seo?.twitter_description || fallbackDescription}
          />
          <meta name="twitter:image" content={firstImage} />

          {seo?.schema && (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  ...seo.schema,
                  mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
                  image: firstImage,
                }),
              }}
            />
          )}

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "首頁",
                    item: SITE_URL,
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: "部落格",
                    item: `${SITE_URL}/blog`,
                  },
                  {
                    "@type": "ListItem",
                    position: 3,
                    name: post.title.rendered,
                    item: canonicalUrl,
                  },
                ],
              }),
            }}
          />
        </Head>

        <div className="max-w-[1920px] mt-20 xl:w-[85%] flex flex-col lg:flex-row w-[95%] mx-auto px-4 py-10">
          <article className="prose w-full p-8 lg:w-[80%] dark:prose-invert">
            <h1 className="text-[5vmin]">{post.title.rendered}</h1>

            <div className="navgation py-5 flex justify-between text-sm text-gray-500 mt-1 mb-6">
              <span>
                <a href="/" className="text-blue-600 hover:underline">
                  首頁
                </a>{" "}
                &gt;{" "}
                <a href="/blog" className="text-blue-600 hover:underline">
                  部落格
                </a>{" "}
                &gt; <span>{post.title.rendered}</span>
              </span>
              <span>
                最後更新時間：
                {new Date(post.modified).toLocaleDateString("zh-TW")}
              </span>
            </div>

            {renderContent(post.content?.rendered)}
          </article>

          <aside className="sidebar w-full lg:w-[20%] p-4 space-y-6">
            <div className="same-category sticky top-8">
              <h3 className="text-lg font-semibold mb-4">更多相似文章</h3>
              {relatedPosts.map((item) => {
                const imgMatch = item.content?.rendered?.match(
                  /<img[^>]+src="([^">]+)"/
                );
                const previewImg = swapToSite(imgMatch?.[1]);
                return (
                  <div key={item.id} className="mb-6 border-b pb-4">
                    {previewImg && (
                      <a href={`/blog/${item.slug}`}>
                        <img
                          src={previewImg}
                          alt={item.title.rendered}
                          className="w-full h-auto mb-2 rounded"
                        />
                      </a>
                    )}
                    <a href={`/blog/${item.slug}`}>
                      <h4 className="text-md font-medium text-blue-600 hover:underline">
                        {item.title.rendered}
                      </h4>
                    </a>
                    <p className="text-gray-500 text-sm">
                      {new Date(item.date).toLocaleDateString("zh-TW")}
                    </p>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>

        <section className="section-others-blog max-w-[1920px] mx-auto xl:w-[85%] w-[90%] py-10">
          <OtherPostsCarousel />
        </section>
      </Layout>
    </>
  );
}

/* ---------- SSG/ISR ---------- */
// 不在 build 階段預抓，避免 TLS/CERT 問題；首訪阻塞產生，之後走 ISR。
export async function getStaticPaths() {
  return { paths: [], fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  try {
    // 單篇
    const postRes = await fetch(
      wp(`/wp/v2/posts?slug=${encodeURIComponent(params.slug)}&_embed`)
    );
    if (!postRes.ok) throw new Error(`Post fetch failed: ${postRes.status}`);
    const posts = await postRes.json();
    const post = posts?.[0];
    if (!post) return { notFound: true, revalidate: 30 };

    // 同分類延伸
    let relatedPosts = [];
    const catId = post.categories?.[0];
    if (catId) {
      try {
        const relRes = await fetch(
          wp(
            `/wp/v2/posts?categories=${catId}&exclude=${post.id}&per_page=6&_embed`
          )
        );
        if (relRes.ok) relatedPosts = await relRes.json();
      } catch {}
    }

    return {
      props: { post, relatedPosts },
      revalidate: 60, // 1 分鐘背景更新
    };
  } catch (e) {
    // 來源掛掉時避免 500 讓整站 build 失敗
    return { notFound: true, revalidate: 30 };
  }
}
