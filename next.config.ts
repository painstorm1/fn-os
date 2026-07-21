import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.FNOS_ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  outputFileTracingIncludes: {
    "/api/lcl-fee": ["./data/타배_배송비용.xlsx"],
  },
};

export default nextConfig;
