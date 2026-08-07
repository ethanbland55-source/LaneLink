import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import SiteChrome from "@/components/site-chrome";
import { getClubSettings, getLiveGala } from "@/lib/queries";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://carnforthotters.co.uk";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Carnforth & District Otters ASC — competitive swimming in Lancaster",
    template: "%s · Carnforth Otters",
  },
  description:
    "Lancaster based competitive swimming club. Coaching from school age to masters, competing in regional and national leagues. Live gala results, squad times and club news.",
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "Carnforth & District Otters ASC",
    url: siteUrl,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#3d1d52",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [club, liveGala] = await Promise.all([getClubSettings(), getLiveGala()]);

  return (
    <html lang="en-GB" className={`${inter.variable} ${poppins.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <a href="#main" className="sr-only-focusable btn btn-primary fixed left-4 top-4 z-100">
          Skip to content
        </a>
        <SiteChrome>
          <SiteHeader
            club={club}
            liveGala={liveGala ? { slug: liveGala.slug, name: liveGala.name } : null}
          />
        </SiteChrome>
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteChrome>
          <SiteFooter club={club} />
        </SiteChrome>
      </body>
    </html>
  );
}
