"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, Radio, X } from "lucide-react";
import { NAV } from "@/lib/nav";
import type { ClubSettings } from "@/lib/types";
import OtterMark from "./otter-mark";

type Props = {
  club: ClubSettings;
  liveGala: { slug: string; name: string } | null;
};

export default function SiteHeader({ club, liveGala }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close everything on navigation.
  useEffect(() => {
    setMobileOpen(false);
    setOpenGroup(null);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpenGroup(null); setMobileOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  // Small delay on close so the pointer can travel into the dropdown.
  const openNow = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenGroup(label);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenGroup(null), 140);
  };

  return (
    <>
      {liveGala && (
        <Link
          href="/live"
          className="block bg-aqua-500 text-white text-center text-sm font-semibold py-2 px-4 hover:bg-aqua-600 transition-colors"
        >
          <span className="inline-flex items-center gap-2.5">
            <span className="live-dot" aria-hidden />
            Live now — {liveGala.name}
            <span className="underline underline-offset-2 decoration-white/60">See results</span>
          </span>
        </Link>
      )}

      <header
        className={`sticky top-0 z-50 transition-shadow duration-200 ${
          scrolled ? "shadow-[0_2px_20px_-8px_rgba(36,16,49,0.35)]" : ""
        }`}
      >
        <div className="bg-white/92 backdrop-blur-lg border-b border-ink-200/80">
          <div className="container-page">
            <div className="flex items-center justify-between gap-4 h-18 py-3">
              <Link
                href="/"
                className="flex items-center gap-3 shrink-0 group"
                aria-label={`${club.name} — home`}
              >
                <OtterMark className="h-11 w-11 shrink-0" />
                <span className="hidden sm:block leading-tight">
                  <span className="block font-[family-name:var(--font-heading)] font-bold text-brand-900 text-[1.02rem] tracking-tight">
                    Carnforth Otters
                  </span>
                  <span className="block text-[0.72rem] text-ink-500 font-medium">
                    Swimming Club · Lancaster
                  </span>
                </span>
              </Link>

              {/* Desktop navigation */}
              <nav className="hidden lg:flex items-center gap-0.5" aria-label="Main">
                {NAV.map((group) => {
                  const hasMenu = group.links.length > 0;
                  const open = openGroup === group.label;
                  return (
                    <div
                      key={group.label}
                      className="relative"
                      onMouseEnter={() => hasMenu && openNow(group.label)}
                      onMouseLeave={closeSoon}
                    >
                      <Link
                        href={group.href}
                        onFocus={() => hasMenu && openNow(group.label)}
                        aria-expanded={hasMenu ? open : undefined}
                        className={`inline-flex items-center gap-1 rounded-full px-3.5 py-2 text-[0.94rem] font-medium transition-colors ${
                          isActive(group.href)
                            ? "text-brand-800 bg-brand-50"
                            : "text-ink-700 hover:text-brand-800 hover:bg-brand-50"
                        }`}
                      >
                        {group.label}
                        {hasMenu && (
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                            aria-hidden
                          />
                        )}
                      </Link>

                      {hasMenu && open && (
                        <div className="absolute left-0 top-full pt-2 w-80 fade-up">
                          <div className="card p-2 shadow-[var(--shadow-lift)]">
                            {group.links.map((link) => (
                              <Link
                                key={link.href}
                                href={link.href}
                                className="block rounded-xl px-3 py-2.5 hover:bg-brand-50 transition-colors"
                              >
                                <span className="block text-[0.94rem] font-semibold text-brand-900">
                                  {link.label}
                                </span>
                                {link.description && (
                                  <span className="block text-[0.8rem] text-ink-500 leading-snug mt-0.5">
                                    {link.description}
                                  </span>
                                )}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>

              <div className="flex items-center gap-2">
                <Link href="/results" className="hidden lg:inline-flex btn btn-ghost btn-sm">
                  <Radio className="h-4 w-4" aria-hidden />
                  Results
                </Link>
                <Link href="/join" className="hidden sm:inline-flex btn btn-primary btn-sm">
                  Join the club
                </Link>

                <button
                  type="button"
                  onClick={() => setMobileOpen((v) => !v)}
                  className="lg:hidden inline-flex items-center justify-center h-11 w-11 rounded-full border border-ink-200 text-brand-800 hover:bg-brand-50 transition-colors"
                  aria-expanded={mobileOpen}
                  aria-controls="mobile-nav"
                  aria-label={mobileOpen ? "Close menu" : "Open menu"}
                >
                  {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 top-0" role="dialog" aria-modal="true">
          <button
            className="absolute inset-0 bg-brand-950/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div
            id="mobile-nav"
            className="absolute inset-x-0 top-0 bg-white max-h-dvh overflow-y-auto pt-20 pb-10 fade-up"
          >
            <nav className="container-page space-y-1" aria-label="Mobile">
              {NAV.map((group) => (
                <div key={group.label} className="py-1.5 border-b border-ink-100 last:border-0">
                  <Link
                    href={group.href}
                    className="block py-2 font-[family-name:var(--font-heading)] font-semibold text-lg text-brand-900"
                  >
                    {group.label}
                  </Link>
                  {group.links.length > 0 && (
                    <div className="pb-2 pl-3 border-l-2 border-brand-100 space-y-0.5">
                      {group.links.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="block py-1.5 text-ink-600 hover:text-brand-700"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-2 pt-5">
                <Link href="/join" className="btn btn-primary w-full">Join the club</Link>
                <Link href="/results" className="btn btn-ghost w-full">Gala results</Link>
              </div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
