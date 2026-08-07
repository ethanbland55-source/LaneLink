"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ExternalLink, FileText, Home, LogOut, Menu, Newspaper, Settings, Trophy, Users, X,
} from "lucide-react";
import OtterMark from "@/components/otter-mark";

const LINKS = [
  { href: "/admin", label: "Dashboard", Icon: Home, exact: true },
  { href: "/admin/galas", label: "Galas & results", Icon: Trophy },
  { href: "/admin/newsletters", label: "Newsletters", Icon: FileText },
  { href: "/admin/people", label: "Who's Who", Icon: Users },
  { href: "/admin/news", label: "News posts", Icon: Newspaper },
  { href: "/admin/pages", label: "Page content", Icon: FileText },
  { href: "/admin/settings", label: "Club settings", Icon: Settings },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    // Hard navigation for the same reason as signing in — it clears the
    // router cache along with the cookie.
    window.location.assign("/admin/login");
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-brand-900 text-white">
        <div className="flex items-center gap-3 px-4 h-16">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <Link href="/admin" className="flex items-center gap-2.5">
            <OtterMark className="h-9 w-9" />
            <span className="font-[family-name:var(--font-heading)] font-semibold">
              Club admin
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/"
              target="_blank"
              className="hidden sm:inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/85 hover:bg-white/10"
            >
              View site
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/85 hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <nav
          className={`${open ? "block" : "hidden"} lg:block fixed lg:sticky inset-x-0 lg:inset-x-auto top-16 lg:top-16 z-20 lg:z-0 bg-white lg:bg-transparent border-b lg:border-b-0 lg:border-r border-ink-200 lg:w-64 shrink-0 lg:h-[calc(100dvh-4rem)] overflow-y-auto`}
          aria-label="Admin"
        >
          <ul className="p-3 space-y-1">
            {LINKS.map(({ href, label, Icon, exact }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.92rem] font-medium transition-colors ${
                    isActive(href, exact)
                      ? "bg-brand-700 text-white"
                      : "text-ink-700 hover:bg-brand-50 hover:text-brand-800"
                  }`}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex-1 min-w-0 p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
