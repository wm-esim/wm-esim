import Head from "next/head";
import { useRouter } from "next/router";
import parse from "html-react-parser";
import dynamic from "next/dynamic";
import Layout from "../Layout";

const OtherPostsCarousel = dynamic(() =>
  import("../../components/OtherPostsCarousel")
);
export default function PostPage({ post, relatedPosts = [] }) {
  const router = useRouter();
  if (router.isFallback) return <div>Loading...</div>;

  const seo = post.yoast_head_json;
  const canonicalUrl = seo?.canonical?.replace(
    "https://dyx.wxv.mybluehost.me/website_a8bfc44c",
    "https://www.wmesim.com"
  );
  const ogUrl = seo?.og_url?.replace(
    "https://dyx.wxv.mybluehost.me/website_a8bfc44c",
    "https://www.wmesim.com"
  );

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "首頁",
        item: "https://www.wmesim.com",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "部落格",
        item: "https://www.wmesim.com/blog",
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
    firstImageMatch?.[1]?.replace(
      "https://dyx.wxv.mybluehost.me/website_a8bfc44c",
      "https://www.wmesim.com"
    ) || "https://www.wmesim.com/logo.png";

  const fallbackDescription =
    post.excerpt?.rendered?.replace(/<[^>]+>/g, "")?.slice(0, 160) ||
    "台灣 eSIM、免簽、自由行教學與最新旅遊資訊";
  const fallbackKeywords = `${post.title.rendered}, eSIM, 台灣eSIM, 旅遊上網, 日本旅遊, 自由行, 簽證, 2025`;

  const renderContent = (html) =>
    parse(html, {
      replace: (node) => {
        if (node.name === "img" && node.attribs?.src) {
          const src = node.attribs.src.replace(
            "https://dyx.wxv.mybluehost.me/website_a8bfc44c",
            "https://www.wmesim.com"
          );
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
              <meta name="max-snippet" content={seo.robots["max-snippet"]} />
              <meta
                name="max-image-preview"
                content={seo.robots["max-image-preview"]}
              />
              <meta
                name="max-video-preview"
                content={seo.robots["max-video-preview"]}
              />
            </>
          )}

          <meta property="og:title" content={seo?.og_title} />
          <meta
            property="og:description"
            content={seo?.og_description || fallbackDescription}
          />
          <meta property="og:type" content={seo?.og_type} />
          <meta property="og:url" content={ogUrl} />
          <meta property="og:site_name" content={seo?.og_site_name} />
          <meta property="og:locale" content={seo?.og_locale} />
          <meta property="og:image" content={firstImage} />

          <meta name="twitter:card" content={seo?.twitter_card} />
          <meta name="twitter:title" content={seo?.twitter_title} />
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
                  mainEntityOfPage: {
                    "@type": "WebPage",
                    "@id": canonicalUrl,
                  },
                  image: firstImage,
                }),
              }}
            />
          )}

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(breadcrumbJsonLd),
            }}
          />
        </Head>

        <div className="max-w-[1920] mt-20 xl:w-[85%] flex flex-col lg:flex-row w-[95%] mx-auto px-4 py-10">
          <article className="prose w-full p-8 lg:w-[80%] dark:prose-invert ">
            <h1 className="text-[5vmin]">{post.title.rendered}</h1>

            {/* ✅ 導覽列 + 更新日期 */}
            <div className="navgation py-5 flex  justify-between text-sm text-gray-500 mt-1 mb-6">
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
              <br />
              <span>
                最後更新時間：
                {new Date(post.modified).toLocaleDateString("zh-TW")}
              </span>
            </div>

            {renderContent(post.content.rendered)}
          </article>
          <div className="sidebar w-full lg:w-[20%] p-4 space-y-6">
            <div className="same-category sticky top-8">
              <h3 className="text-lg font-semibold mb-4">更多相似文章</h3>
              {relatedPosts.map((item) => {
                const imageMatch = item.content.rendered.match(
                  /<img[^>]+src="([^">]+)"/
                );
                const previewImg = imageMatch?.[1]?.replace(
                  "https://dyx.wxv.mybluehost.me/website_a8bfc44c",
                  "https://www.wmesim.com"
                );

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
          </div>
        </div>
        <section className="section-others-blog max-w-[1920px] mx-auto xl:w-[85%] w-[90%] py-10">
          <OtherPostsCarousel />
        </section>
      </Layout>
    </>
  );
}

export async function getStaticPaths() {
  const res = await fetch(
    `https://fegoesim.com/wp-json/wp/v2/posts?_fields=slug&per_page=20`
  );
  const posts = await res.json();

  const paths = posts.map((post) => ({
    params: { slug: post.slug },
  }));

  return {
    paths,
    fallback: true,
  };
}

export async function getStaticProps({ params }) {
  const res = await fetch(
    `https://fegoesim.com/wp-json/wp/v2/posts?slug=${params.slug}&_embed`
  );
  const posts = await res.json();

  if (!posts[0]) return { notFound: true };
  const post = posts[0];

  // 抓第一個分類 ID（可依你需求調整為多分類）
  const categoryId = post.categories?.[0];

  let relatedPosts = [];
  if (categoryId) {
    const relRes = await fetch(
      `https://fegoesim.com/wp-json/wp/v2/posts?categories=${categoryId}&exclude=${post.id}&per_page=6&_embed`
    );
    relatedPosts = await relRes.json();
  }

  return {
    props: {
      post,
      relatedPosts,
    },
    revalidate: 10,
  };
}
