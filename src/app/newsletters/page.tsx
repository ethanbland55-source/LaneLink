import type { Metadata } from "next";
import { Download, ExternalLink, FileText } from "lucide-react";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getNewsletters } from "@/lib/queries";
import { formatFileSize, newsletterFreshness, newsletterPeriod } from "@/lib/format";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Newsletters",
  description:
    "Every issue of the Carnforth Otters newsletter — squad news, gala reports, swimmer of the month and club announcements.",
};

export default async function NewslettersPage() {
  const newsletters = await getNewsletters();
  const [latest, ...archive] = newsletters;

  // Group by the year the issue *finishes* in, which is when it came out.
  const byYear = new Map<string, typeof archive>();
  for (const n of archive) {
    const year = (n.period_end ?? n.issue_date).slice(0, 4);
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
        intro="Squad news, gala reports, swimmer of the month and everything else happening around the club — written by the committee. Some issues cover two months."
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
          {/* ---------------------------------------------- Current issue --- */}
          <Section title="">
            <div className="card overflow-hidden">
              <div className="grid lg:grid-cols-[1fr_22rem]">
                <div className="p-8 md:p-10 order-2 lg:order-1">
                  {newsletterFreshness(latest.period_end) && (
                    <span className="badge badge-gold mb-4">
                      {newsletterFreshness(latest.period_end)}
                    </span>
                  )}
                  <p className="eyebrow mb-2">
                    {newsletterPeriod(latest.period_start, latest.period_end)}
                  </p>
                  <h2 className="text-[clamp(1.5rem,3vw,2.1rem)]">{latest.title}</h2>
                  {latest.summary && (
                    <p className="mt-4 text-ink-600 max-w-xl">{latest.summary}</p>
                  )}
                  <div className="mt-7 flex flex-wrap gap-3">
                    <a
                      href={latest.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                    >
                      <FileText className="h-4 w-4" aria-hidden />
                      Read this issue
                    </a>
                    <a
                      href={latest.file_url}
                      download
                      className="btn btn-ghost"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                      Download
                      {latest.file_size ? (
                        <span className="text-ink-400 font-normal">
                          {formatFileSize(latest.file_size)}
                        </span>
                      ) : null}
                    </a>
                  </div>
                </div>

                {/* First page of the PDF, shown inline. Browsers that can't
                    render a PDF frame fall back to the cover image or a plain
                    link, so nobody hits a blank box. */}
                <div className="order-1 lg:order-2 bg-brand-50 border-b lg:border-b-0 lg:border-l border-ink-200 min-h-64">
                  {latest.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={latest.cover_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <object
                      data={`${latest.file_url}#page=1&view=FitH&toolbar=0&navpanes=0`}
                      type="application/pdf"
                      className="h-full w-full min-h-72"
                      aria-label={`First page of ${latest.title}`}
                    >
                      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
                        <FileText className="h-10 w-10 text-brand-300" aria-hidden />
                        <a
                          href={latest.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.9rem] font-semibold text-brand-700 hover:text-gold-700"
                        >
                          Open the PDF
                          <ExternalLink className="inline h-3.5 w-3.5 ml-1.5" aria-hidden />
                        </a>
                      </div>
                    </object>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* ----------------------------------------------------- Archive --- */}
          {years.length > 0 && (
            <Section eyebrow="Archive" title="Earlier issues" className="pt-0 bg-wash">
              <div className="space-y-9">
                {years.map((year) => (
                  <div key={year}>
                    <h3 className="text-lg mb-3">{year}</h3>
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {(byYear.get(year) ?? []).map((n) => (
                        <li key={n.id}>
                          <a
                            href={n.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="card card-hover group flex h-full flex-col p-5"
                          >
                            <div className="flex items-start gap-3">
                              <FileText className="h-5 w-5 shrink-0 text-brand-400 mt-0.5" aria-hidden />
                              <div className="min-w-0">
                                <span className="block text-[0.78rem] uppercase tracking-wider text-ink-400 font-semibold">
                                  {newsletterPeriod(n.period_start, n.period_end)}
                                </span>
                                <span className="block font-semibold text-brand-900 group-hover:text-brand-600 transition-colors mt-0.5">
                                  {n.title}
                                </span>
                              </div>
                            </div>
                            {n.summary && (
                              <p className="mt-3 text-[0.85rem] text-ink-600 line-clamp-2">
                                {n.summary}
                              </p>
                            )}
                            <span className="mt-auto pt-4 flex items-center gap-1.5 text-[0.82rem] text-ink-400">
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              PDF{n.file_size ? ` · ${formatFileSize(n.file_size)}` : ""}
                            </span>
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
