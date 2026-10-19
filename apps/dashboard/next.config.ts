import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    DEMO_CHANNEL_ENABLED: process.env.DEMO_CHANNEL_ENABLED ?? "false",
  },
  compiler: {
    styledComponents: true,
  },
  transpilePackages: ["@rf-intelligence/ui"],
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "@prisma/client",
    "@rf-intelligence/db",
    "ably",
    "bcryptjs",
    "inngest",
  ],
  async redirects() {
    return [
      {
        source: "/documents",
        destination: "/reports?tab=documents",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
