import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/share",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
        { key: "Permissions-Policy", value: "geolocation=(self)" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }];
  },
};

export default nextConfig;
