import type { Metadata } from "next";
import { Download, FileText } from "lucide-react";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getNewsletters } from "@/lib/queries";
import { formatDate, formatFileSize } from "@/lib/format";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Newsletters",
  description:
    "Every issue of the Carnforth Otters newsletter — squad news, gala reports, swimmer of the month and club announcements.",
};

export default async function NewslettersPage() {
  const newsletters = await getNewsletters();
  const [latest, ...archive] = newsletters;

  const byYear = new Map<string, typeof archive>();
  for (const n of archive) {
    const year = n.issue_date.slice(0, 4);
    const list = byYear.get(year);
    if (list) list.push(n);
    else byYear.set(year, [n]);
  }
  const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <>
      <PageHero
        eyebrow="Club"
        title="Newsletters"
        intro="Squad news, gala reports, swimmer of the month and everything else happening around the club — written by the committee, published every couple of months."
      />

      {newsletters.length === 0 ? (
        <Section title="">
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No newsletters published yet"
            message="Issues will appear here as soon as the first one is uploaded."
          />
        </Section>
      ) : (
        <>
          <Section eyebrow="Latest issue" title={latest.title}>
            <div className="card overflow-hidden">
              <div className="grid md:grid-cols-[1fr_auto] gap-6 p-7 md:p-9 items-center">
                <div>
                  <p className="text-[0.82rem] uppercase tracking-wider text-ink-400 font-semibold">
                    {formatDate(latest.issue_date)}
                  </p>
                  {latest.summary && (
                    <p className="mt-3 text-ink-600 max-w-xl">{latest.summary}</p>
                  )}
                  <a
                    href={latest.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary mt-6"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Read this issue
                    {latest.file_size ? (
                      <span className="text-brand-950/60 font-normal">
                        ({formatFileSize(latest.file_size)})
                      </span>
                    ) : null}
                  </a>
                </div>
                <div className="hidden md:flex h-40 w-32 shrink-0 items-center justify-center rounded-xl bg-brand-50 border border-brand-100">
                  <FileText className="h-12 w-12 text-brand-300" aria-hidden />
                </div>
              </div>
            </div>
          </Section>

          {years.length > 0 && (
            <Section eyebrow="Archive" title="Earlier issues" className="pt-0">
              <div className="space-y-8">
                {years.map((year) => (
                  <div key={year}>
                    <h3 className="text-lg mb-3">{year}</h3>
                    <ul className="card divide-y divide-ink-100">
                      {(byYear.get(year) ?? []).map((n) => (
                        <li key={n.id}>
                          <a
                            href={n.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-4 px-5 py-4 hover:bg-brand-50 transition-colors group"
                          >
                            <FileText className="h-4.5 w-4.5 shrink-0 text-brand-400" aria-hidden />
                            <span className="flex-1 min-w-0">
                              <span className="block font-medium text-brand-900 group-hover:text-brand-600 transition-colors">
                                {n.title}
                              </span>
                              <span className="block text-[0.82rem] text-ink-500">
                                {formatDate(n.issue_date)}
                              </span>
                            </span>
                            {n.file_size ? (
                              <span className="text-[0.8rem] text-ink-400 tnum hidden sm:block">
                                {formatFileSize(n.file_size)}
                              </span>
                            ) : null}
                            <Download className="h-4 w-4 text-ink-400 shrink-0" aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}
