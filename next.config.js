const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Lint runs once, as `npm run lint` and the Lint workflow, with
  // eslint.config.js (5.59.12). `next build` would otherwise run Next 14's
  // own lint pass too, which predates flat config, and a lint finding
  // would then block a production deploy.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = withBundleAnalyzer(nextConfig);
