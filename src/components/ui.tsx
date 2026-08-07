import Link from "next/link";
import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Page hero — the deep purple band at the top of every inner page.            */
/* -------------------------------------------------------------------------- */

export function PageHero({
  eyebrow,
  title,
  intro,
  children,
  breadcrumbs,
}: {
  eyebrow?: string;
  title: string;
  intro?: string | null;
  children?: ReactNode;
  breadcrumbs?: { href: string; label: string }[];
}) {
  return (
    <section className="bg-deep lane-lines text-white">
      <div className="container-page py-14 md:py-20">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-5">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82rem] text-brand-200/80">
              {breadcrumbs.map((crumb, i) => (
                <li key={crumb.href} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden className="text-brand-300/50">/</span>}
                  <Link href={crumb.href} className="hover:text-white transition-colors">
                    {crumb.label}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
        )}
        {eyebrow && <p className="eyebrow text-gold-400 mb-3">{eyebrow}</p>}
        <h1 className="text-white text-[clamp(2rem,5vw,3.1rem)] max-w-4xl">{title}</h1>
        {intro && (
          <p className="mt-5 text-lg text-brand-100/85 max-w-2xl text-balance">{intro}</p>
        )}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function Section({
  eyebrow,
  title,
  intro,
  children,
  className = "",
  action,
  id,
}: {
  eyebrow?: string;
  title?: string;
  intro?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={`py-14 md:py-20 scroll-mt-header ${className}`}>
      <div className="container-page">
        {(title || eyebrow) && (
          <div className="flex flex-wrap items-end justify-between gap-4 mb-9">
            <div className="max-w-2xl">
              {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
              {title && <h2 className="text-[clamp(1.6rem,3.4vw,2.25rem)]">{title}</h2>}
              {intro && <p className="mt-3 text-ink-600">{intro}</p>}
            </div>
            {action}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="card p-10 text-center">
      {icon && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
          {icon}
        </div>
      )}
      <p className="font-[family-name:var(--font-heading)] font-semibold text-lg text-brand-900">
        {title}
      </p>
      <p className="mt-2 text-ink-500 max-w-md mx-auto">{message}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Renders markdown that has already been converted to HTML by markdownToHtml. */
export function Prose({ html, className = "" }: { html: string; className?: string }) {
  if (!html) return null;
  return (
    <div
      className={`prose-club ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* -------------------------------------------------------------------------- */

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-[family-name:var(--font-heading)] font-bold text-[clamp(1.75rem,4vw,2.5rem)] leading-none text-gold-400">
        {value}
      </p>
      <p className="mt-2 text-sm text-brand-100/80">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function Badge({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "gold" | "live" | "muted" | "open" | "closed";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
