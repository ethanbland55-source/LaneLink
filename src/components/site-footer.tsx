import Link from "next/link";
import { Facebook, Instagram, Lock, Mail, Youtube } from "lucide-react";
import { FOOTER_EXTRA, NAV } from "@/lib/nav";
import type { ClubSettings } from "@/lib/types";
import OtterMark from "./otter-mark";

export default function SiteFooter({ club }: { club: ClubSettings }) {
  const year = new Date().getFullYear();

  const socials = [
    { href: club.facebook, label: "Facebook", Icon: Facebook },
    { href: club.youtube, label: "YouTube", Icon: Youtube },
    { href: club.instagram, label: "Instagram", Icon: Instagram },
  ].filter((s): s is { href: string; label: string; Icon: typeof Facebook } => Boolean(s.href));

  return (
    <footer className="bg-deep lane-lines text-white mt-24">
      <div className="container-page py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <div className="flex items-center gap-3">
              <OtterMark className="h-12 w-12" />
              <div className="leading-tight">
                <p className="font-[family-name:var(--font-heading)] font-bold text-lg">
                  Carnforth &amp; District Otters
                </p>
                <p className="text-sm text-brand-200">Amateur Swimming Club</p>
              </div>
            </div>

            <p className="mt-5 text-brand-100/85 text-[0.95rem] max-w-sm">
              {club.strapline} Training at {club.primaryVenue ?? "Salt Ayre Leisure Centre"} and
              pools across the Lancaster district.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              {socials.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/25 text-white/85 hover:bg-white/15 hover:text-white transition-colors"
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </a>
              ))}
              <a
                href={`mailto:${club.email}`}
                className="inline-flex items-center gap-2 rounded-full border border-white/25 px-4 h-10 text-sm text-white/85 hover:bg-white/15 hover:text-white transition-colors"
              >
                <Mail className="h-4 w-4" aria-hidden />
                {club.email}
              </a>
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {NAV.filter((g) => g.links.length > 0).map((group) => (
              <div key={group.label}>
                <p className="font-[family-name:var(--font-heading)] font-semibold text-sm uppercase tracking-wider text-gold-400">
                  {group.label}
                </p>
                <ul className="mt-3 space-y-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-[0.92rem] text-brand-100/80 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 pt-7 border-t border-white/15 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.85rem] text-brand-200/75">
            <span>© {year} Carnforth &amp; District Otters ASC</span>
            {FOOTER_EXTRA.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-white transition-colors">
                {link.label}
              </Link>
            ))}
          </div>

          {/* Volunteers need to find this without being told the URL each time. */}
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/25 px-4 py-2 text-[0.85rem] text-white/85 hover:bg-white/15 hover:text-white transition-colors"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Club admin sign in
          </Link>
        </div>

        <p className="mt-6 text-[0.8rem] text-brand-200/60">
          Swim England affiliated · SwimMark accredited · Run entirely by volunteers
        </p>
      </div>
    </footer>
  );
}
