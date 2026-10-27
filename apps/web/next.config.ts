import type { NextConfig } from "next";

const PUBLIC_COORDINATOR = "https://veil-coordinator.fly.dev";

function apiOrigin(): string {
  let raw = (process.env.VEIL_API_ORIGIN ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (raw && !/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  raw = raw.replace(/\/$/, "");
  const onVercel = process.env.VERCEL === "1";
  if (onVercel && (!raw || raw.includes("trycloudflare.com"))) {
    return PUBLIC_COORDINATOR;
  }
  return raw || "http://127.0.0.1:8787";
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
