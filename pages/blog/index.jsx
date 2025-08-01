import Link from "next/link";
import Image from "next/image";
import Layout from "../Layout";
import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";

// 🔧 擷取文章內第一張圖片 URL
function extractFirstImageFromContent(content) {
  const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

// ✨ 動畫參數
const fadeUpVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

export default function BlogPage({ posts }) {
  return (
    <Layout>
      <div className="max-w-[1920px] pb-[100px] pt-[200px] w-[90%] xl:w-[85%] mx-auto px-4">
        <h1 className="text-3xl font-bold mb-8 text-center">部落格文章</h1>

        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, index) => {
            const previewImage = extractFirstImageFromContent(
              post.content.rendered
            );
            const postUrl = `/blog/${post.slug}`;
            const [ref, inView] = useInView({
              triggerOnce: true,
              threshold: 0.2,
            });

            return (
              <motion.div
                key={post.id}
                ref={ref}
                variants={fadeUpVariants}
                initial="hidden"
                animate={inView ? "visible" : "hidden"}
                className="overflow-hidden transition-all"
              >
                <Link href={postUrl}>
                  <div className="relative w-full h-0 pb-[75%]">
                    {previewImage && (
                      <Image
                        src={previewImage}
                        alt={post.title.rendered}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 33vw"
                        priority={false}
                      />
                    )}
                  </div>
                </Link>

                <div className="py-8">
                  <Link href={postUrl}>
                    <h2 className="text-lg text-left w-[80%] font-semibold text-blue-600 hover:underline mb-2 line-clamp-2">
                      {post.title.rendered}
                    </h2>
                  </Link>
                  <p className="text-gray-500 text-sm mb-2">
                    {new Date(post.date).toLocaleDateString()}
                  </p>
                  <div
                    className="text-gray-700 text-sm line-clamp-3"
                    dangerouslySetInnerHTML={{ __html: post.excerpt.rendered }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}

export async function getStaticProps() {
  const res = await fetch(
    `https://fegoesim.com/wp-json/wp/v2/posts?per_page=20&_embed`
  );
  const posts = await res.json();

  return {
    props: {
      posts,
    },
    revalidate: 10,
  };
}
