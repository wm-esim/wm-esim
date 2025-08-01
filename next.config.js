const path = require("path");

module.exports = {
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
  trailingSlash: true,
  webpackDevMiddleware: (config) => {
    config.watchOptions = {
      poll: 1000,
      aggregateTimeout: 300,
    };
    return config;
  },
  sassOptions: {
    includePaths: [path.join(__dirname, "styles")],
  },
  // async rewrites() {
  //   return [
  //     {
  //       source: "/api/:path*",
  //       destination: "https://external-api.com/:path*",
  //     },
  //   ];
  // },

  // ⬇️ 加入 WebGL Shader 支援設定
  webpack(config) {
    config.module.rules.push({
      test: /\.(glsl|vs|fs)$/,
      use: ["babel-loader", "babel-plugin-glsl"],
    });
    return config;
  },
};
