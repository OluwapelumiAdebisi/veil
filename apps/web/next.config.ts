import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.47"],
  async rewrites() {
    return [
      {
        source: "/veil/:path*",
        destination: "http://127.0.0.1:8787/:path*",
      },
    ];
  },
};

export default nextConfig;
