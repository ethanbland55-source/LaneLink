"use client";

import { usePathname } from "next/navigation";
import { Nav } from "./nav";
import { Lock } from "./lock";
import { Fresh } from "./fresh";

/**
 * The app chrome, or none of it.
 *
 * The sign-in page is full-bleed and has nowhere to navigate to, so it gets
 * neither the tab bar nor the centred column the rest of the app sits in.
 *
 * `Fresh` sits outside that split, because a stale sign-in page is as broken
 * as any other — it posts to a route that has moved and the button looks dead.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/login") {
    return (
      <>
        <Fresh />
        {children}
      </>
    );
  }

  return (
    <>
      <Fresh />
      <Lock />
      <Nav />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-5">{children}</main>
    </>
  );
}
