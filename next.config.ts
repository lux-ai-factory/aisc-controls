import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next.js doesn't get confused by a stray
  // package-lock.json in an ancestor directory.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
