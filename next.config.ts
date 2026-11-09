import type { NextConfig } from "next";

/**
 * Dev (`next dev`) and production (`next build`) must not share `.next`.
 * Running build while the dev server is up overwrites webpack chunk maps and
 * causes runtime MODULE_NOT_FOUND / SegmentViewNode Client Manifest errors.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
