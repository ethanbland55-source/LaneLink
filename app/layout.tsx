import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meal Hub",
  description: "Daily macro tracking against a fixed meal plan.",
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen">
        <nav className="sticky top-0 z-40 border-b border-[#1e2637] bg-[#05070d]/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
            <Link href="/" className="mr-auto flex items-center gap-2 font-bold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#38e2b0] text-sm text-[#04120d]">
                M
              </span>
              Meal Hub
            </Link>
            <Link href="/" className="btn btn-ghost">
              Today
            </Link>
            <Link href="/plan" className="btn btn-ghost">
              Plan &amp; Settings
            </Link>
          </div>
        </nav>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
