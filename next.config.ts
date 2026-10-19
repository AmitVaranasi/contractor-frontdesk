import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sponsor SDKs open sockets and read local files; keep them out of the bundle.
  serverExternalPackages: ["rocketride", "@celestoai/sdk"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
