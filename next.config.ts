import type { NextConfig } from "next";

// Optional path-prefix for platform routing (e.g. behind Caddy at /controls).
// Empty/unset → served at the root (standalone or subdomain). Set NEXT_BASE_PATH
// at build time to deploy under a subpath; assets are prefixed to match.
const basePath = process.env.NEXT_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next.js doesn't get confused by a stray
  // package-lock.json in an ancestor directory.
  outputFileTracingRoot: __dirname,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
