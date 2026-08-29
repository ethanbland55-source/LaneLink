"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today" },
  { href: "/plan", label: "Plan" },
  { href: "/shop", label: "Shop" },
  { href: "/progress", label: "Progress" },
];

export function Nav() {
  const path = usePathname();

  return (
    <header className="mx-auto flex max-w-3xl items-center gap-3 px-4 pt-5">
      <span className="mr-auto text-[0.95rem] font-bold tracking-tight">
        Meal<span className="text-[var(--color-accent)]">Hub</span>
      </span>

      {/* Segmented control — the active tab is a filled pill, not a border. */}
      <nav className="flex gap-0.5 rounded-full bg-[var(--color-surface)] p-1 sm:gap-1">
        {TABS.map((t) => {
          const active = path === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-full px-2.5 py-1.5 text-[0.8rem] font-semibold transition sm:px-4 sm:text-sm"
              style={
                active
                  ? { background: "var(--color-accent)", color: "#10160a" }
                  : { color: "var(--color-mut)" }
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
