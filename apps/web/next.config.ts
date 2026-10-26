import type { NextConfig } from "next";

function apiOrigin(): string {
  let raw = (process.env.VEIL_API_ORIGIN ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw) {
    return "http://127.0.0.1:8787";
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  return raw.replace(/\/$/, "");
}

const coordinator = apiOrigin();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.47"],
  async rewrites() {
    return [
      {
        source: "/veil/:path*",
        destination: `${coordinator}/:path*`,
      },
    ];
  },
};

export default nextConfig;
