import Head from "next/head";
import { useRouter } from "next/router";
import parse from "html-react-parser";
import dynamic from "next/dynamic";
import Layout from "../Layout";

const OtherPostsCarousel = dynamic(() =>
  import("../../components/OtherPostsCarousel")
);

// ✅ 使用環境變數設定
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "ｃ";
const WP_BASE =
  process.env.NEXT_PUBLIC_WP_API_BASE_URL?.replace(/\/+$/, "") ||
  "https://fegoesim.com";
const WP_API = (p) => `${WP_BASE}/wp-json${p}`;

export default function PostPage({ post, relatedPosts = [] }) {
  const router = useRouter();
  if (router.isFallback) return <div>Loading...</div>;

  const seo = post.yoast_head_json;
  const canonicalUrl =
    seo?.canonical?.replace(WP_BASE, SITE_URL) ||
    `${SITE_URL}/blog/${post.slug}`;
  const ogUrl =
    seo?.og_url?.replace(WP_BASE, SITE_URL) || `${SITE_URL}/blog/${post.slug}`;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
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
  };

  const firstImageMatch = post.content.rendered.match(
    /<img[^>]+src="([^">]+)"/
  );
  const firstImage =
    firstImageMatch?.[1]?.replace(WP_BASE, SITE_URL) || `${SITE_URL}/logo.png`;

  const fallbackDescription =
    post.excerpt?.rendered?.replace(/<[^>]+>/g, "")?.slice(0, 160) ||
    "台灣 eSIM、免簽、自由行教學與最新旅遊資訊";
  const fallbackKeywords = `${post.title.rendered}, eSIM, 台灣eSIM, 旅遊上網, 日本旅遊, 自由行, 簽證, 2025`;

  const renderContent = (html) =>
    parse(html, {
      replace: (node) => {
        if (node.name === "img" && node.attribs?.src) {
          const src = node.attribs.src.replace(WP_BASE, SITE_URL);
          return (
            <img
              src={src}
              alt={node.attribs.alt || ""}
              width="100%"
              loading="lazy"
            />
          );
        }
      },
    });

  return (
    <Layout>
      <Head>
        <title>{seo?.title || `${post.title.rendered}｜部落格文章`}</title>
        <meta
          name="description"
          content={seo?.description || fallbackDescription}
        />
        <meta name="keywords" content={fallbackKeywords} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:image" content={firstImage} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      </Head>

      <div className="max-w-[1920px] mt-20 xl:w-[85%] flex flex-col lg:flex-row w-[95%] mx-auto px-4 py-10">
        <article className="prose w-full p-8 lg:w-[80%] dark:prose-invert ">
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
              最後更新時間：dfdsfdsfdsf
              {new Date(post.modified).toLocaleDateString("zh-TW")}
            </span>
          </div>
          {renderContent(post.content.rendered)}
        </article>

        <div className="sidebar w-full lg:w-[20%] p-4 space-y-6">
          <h3 className="text-lg font-semibold mb-4">更多相似文章</h3>
          {relatedPosts.map((item) => {
            const match = item.content.rendered.match(
              /<img[^>]+src="([^">]+)"/
            );
            const preview = match?.[1]?.replace(WP_BASE, SITE_URL);
            return (
              <div key={item.id} className="mb-6 border-b pb-4">
                {preview && (
                  <a href={`/blog/${item.slug}`}>
                    <img
                      src={preview}
                      alt={item.title.rendered}
                      className="rounded mb-2"
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
      </div>

      <section className="section-others-blog max-w-[1920px] mx-auto xl:w-[85%] w-[90%] py-10">
        <OtherPostsCarousel />
      </section>
    </Layout>
  );
}

export async function getStaticPaths() {
  // ✅ 避免 build-time TLS error
  return { paths: [], fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  try {
    const res = await fetch(WP_API(`/wp/v2/posts?slug=${params.slug}&_embed`));
    const posts = await res.json();
    if (!posts[0]) return { notFound: true };

    const post = posts[0];
    const categoryId = post.categories?.[0];
    let relatedPosts = [];

    if (categoryId) {
      const relRes = await fetch(
        WP_API(
          `/wp/v2/posts?categories=${categoryId}&exclude=${post.id}&per_page=6&_embed`
        )
      );
      relatedPosts = await relRes.json();
    }

    return { props: { post, relatedPosts }, revalidate: 60 };
  } catch (e) {
    console.error("❌ getStaticProps error:", e);
    return { notFound: true, revalidate: 30 };
  }
}
