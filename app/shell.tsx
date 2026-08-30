"use client";

import { usePathname } from "next/navigation";
import { Nav } from "./nav";

/**
 * The app chrome, or none of it.
 *
 * The sign-in page is full-bleed and has nowhere to navigate to, so it gets
 * neither the tab bar nor the centred column the rest of the app sits in.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/login") return <>{children}</>;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-5">{children}</main>
    </>
  );
}
