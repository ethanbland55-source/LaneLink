"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { href: "/", label: "Today" },
  { href: "/plan", label: "Plan" },
  { href: "/shop", label: "Shop" },
  { href: "/progress", label: "Progress" },
];

export function Nav() {
  const path = usePathname();
  /**
   * Whose plan this is. Only shown once there is more than one account, so a
   * single-user install stays as uncluttered as it was — but the moment
   * someone else signs up it becomes the most important word on the screen.
   */
  const [me, setMe] = useState<{ name: string; shared: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (live && d?.me) {
          // First name only. The header is a brand, four tabs and a sign-out
          // icon on a 375px phone; a full name has about seventy pixels to
          // live in and "Rowan Ellis" became "Rowa…", which reads as a bug
          // rather than as a name.
          const full = String(d.me.display_name).trim();
          setMe({ name: full.split(/\s+/)[0] || full, shared: (d.others ?? 0) > 0 });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <header className="mx-auto flex max-w-3xl items-center gap-3 px-4 pt-5">
      {/* The brand never shrinks; a person's name might be long, so that one
          does. Sharing one class between the two truncated "MealHub" to
          "MealH…" on a phone, which looks like a bug rather than a name. */}
      <span
        className={`mr-auto text-[0.95rem] font-bold tracking-tight ${
          me?.shared ? "min-w-0 truncate" : "shrink-0"
        }`}
      >
        {me?.shared ? (
          me.name
        ) : (
          <>
            Meal<span className="text-[var(--color-accent)]">Hub</span>
          </>
        )}
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

      <button
        title="Sign out"
        aria-label="Sign out"
        className="hit shrink-0 rounded-full p-1.5 text-[#4a505c] transition hover:text-[var(--color-fat)]"
        onClick={async () => {
          await fetch("/api/auth", { method: "DELETE" });
          window.location.href = "/login";
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h11"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </header>
  );
}
