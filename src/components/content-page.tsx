import { PageHero, Prose, Section } from "@/components/ui";
import { getPage } from "@/lib/queries";
import { markdownToHtml } from "@/lib/format";
import type { ReactNode } from "react";

/**
 * Renders a page whose body is edited in the admin area, falling back to
 * sensible built-in copy if nobody has written it yet. Keeps every "wordy"
 * page consistent without duplicating layout code seven times.
 */
export default async function ContentPage({
  slug,
  fallbackTitle,
  fallbackIntro,
  fallbackBody,
  eyebrow,
  breadcrumbs,
  children,
}: {
  slug: string;
  fallbackTitle: string;
  fallbackIntro?: string;
  fallbackBody?: string;
  eyebrow?: string;
  breadcrumbs?: { href: string; label: string }[];
  children?: ReactNode;
}) {
  const page = await getPage(slug);
  const title = page?.title ?? fallbackTitle;
  const intro = page?.intro ?? fallbackIntro ?? null;
  const body = page?.body ?? fallbackBody ?? "";

  return (
    <>
      <PageHero eyebrow={eyebrow} title={title} intro={intro} breadcrumbs={breadcrumbs} />
      {body && (
        <Section title="">
          <Prose html={markdownToHtml(body)} />
        </Section>
      )}
      {children}
    </>
  );
}
