import type { NextConfig } from "next";

const apiOrigin = (process.env.VEIL_API_ORIGIN ?? "http://127.0.0.1:8787").replace(/\/$/, "");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.47"],
  async rewrites() {
    return [
      {
        source: "/veil/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
