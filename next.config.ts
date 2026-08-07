import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
        : []),
      // Legacy media still served from the old WordPress host during transition.
      { protocol: "https" as const, hostname: "carnforthotters.co.uk" },
    ],
  },
  async redirects() {
    // 301s so links printed on old programmes / shared on Facebook keep working.
    return [
      { source: "/openmeets", destination: "/competing/open-meets", permanent: true },
      { source: "/newsletter", destination: "/newsletters", permanent: true },
      { source: "/about-us/meet-the-team", destination: "/about/whos-who", permanent: true },
      { source: "/about-us/committee", destination: "/about/whos-who", permanent: true },
      { source: "/about-us/:path*", destination: "/about/:path*", permanent: true },
      { source: "/training/training-information", destination: "/training", permanent: true },
      { source: "/joining-carnforth-otters", destination: "/join", permanent: true },
      { source: "/competing/leagues-meets-galas", destination: "/competing/fixtures", permanent: true },
    ];
  },
};

export default nextConfig;
