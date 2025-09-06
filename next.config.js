// next.config.js
const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 關閉 Next 自動做尾斜線 308 轉址（避免 POST body 在 30x 中遺失）
  skipTrailingSlashRedirect: true,
  // 不再強制全站尾斜線
  // trailingSlash: false, // 不寫等於預設 false；若你有設 true，請改成 false 或移除

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "fegoesim.com",
        pathname: "/wp-content/uploads/**",
      },
      {
        protocol: "https",
        hostname: "images.pexels.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i0.wp.com",
        pathname: "/**",
      },
    ],
  },

  sassOptions: {
    includePaths: [path.join(__dirname, "styles")],
  },

  // 讓「有尾斜線」也能直達「檔案版」API，不經過 30x
  async rewrites() {
    return [
      { source: "/api/newebpay-notify/",   destination: "/api/newebpay-notify" },
      { source: "/api/newebpay-callback/", destination: "/api/newebpay-callback" },
    ];
  },

  // ⬇️ 保留你的 WebGL Shader 設定
  webpack(config) {
    config.module.rules.push({
      test: /\.(glsl|vs|fs)$/,
      use: ["babel-loader", "babel-plugin-glsl"],
    });
    return config;
  },
};

module.exports = nextConfig;
