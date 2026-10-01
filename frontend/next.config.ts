import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev and build must not share a build directory: `next build` rewrites the
  // page manifest while `next dev` is serving from it, which breaks page-data
  // collection and can leave the running dev server returning 500s. The npm
  // scripts point dev at its own directory; production keeps the default so
  // `next build` and `next start` continue to agree.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;