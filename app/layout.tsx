import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "./shell";

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
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
