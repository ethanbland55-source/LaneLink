import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "Meal Hub",
  description: "Daily macro tracking against a fixed meal plan.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-3xl px-4 pb-24 pt-5">{children}</main>
      </body>
    </html>
  );
}
