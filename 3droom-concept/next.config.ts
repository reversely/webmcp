import type { NextConfig } from "next";

/** The shared client ships as TypeScript source from the workspace, so Next transpiles it. */
const nextConfig: NextConfig = { transpilePackages: ["@webmcp/shopify-ucp"] };

export default nextConfig;
