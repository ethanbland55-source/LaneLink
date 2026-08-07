"use client";

import { usePathname } from "next/navigation";

/**
 * The admin area has its own shell, so the public header and footer are hidden
 * there. Doing it with a pathname check keeps every page under a single root
 * layout — no route-group shuffling, and one <html> element.
 */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return <>{children}</>;
}
