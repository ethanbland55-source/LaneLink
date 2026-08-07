import type { Metadata } from "next";
import { Download, FileText, ShieldCheck } from "lucide-react";
import ContentPage from "@/components/content-page";
import { EmptyState, Section } from "@/components/ui";
import { getDocuments } from "@/lib/queries";
import { formatDate, formatFileSize } from "@/lib/format";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Policies & safeguarding",
  description:
    "Wavepower safeguarding, club policies, data protection and the documents that govern how Carnforth Otters is run.",
};

export default async function PoliciesPage() {
  const documents = await getDocuments();

  const byCategory = new Map<string, typeof documents>();
  for (const doc of documents) {
    const list = byCategory.get(doc.category);
    if (list) list.push(doc);
    else byCategory.set(doc.category, [doc]);
  }

  return (
    <ContentPage
      slug="policies"
      eyebrow="About"
      breadcrumbs={[
        { href: "/about", label: "About" },
        { href: "/about/policies", label: "Policies" },
      ]}
      fallbackTitle="Policies & safeguarding"
      fallbackIntro="Everything that governs how the club is run, and how we keep swimmers safe."
      fallbackBody={`Carnforth Otters is affiliated to Swim England and operates under **Wavepower**, Swim England's child safeguarding policy and procedures for clubs.

If you have a concern about the welfare of a child at the club, speak to our Welfare Officer — you'll find their contact details on the Who's Who page. Concerns are always taken seriously and handled confidentially.`}
    >
      <Section eyebrow="Documents" title="Club documents" className="bg-wash">
        {documents.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title="No documents uploaded yet"
            message="Club policies, the safeguarding statement and data protection notice will be published here."
          />
        ) : (
          <div className="space-y-8 max-w-3xl">
            {[...byCategory.entries()].map(([category, docs]) => (
              <div key={category}>
                <h2 className="text-lg mb-3 capitalize">{category.replace(/-/g, " ")}</h2>
                <ul className="card divide-y divide-ink-100">
                  {docs.map((doc) => (
                    <li key={doc.id}>
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-brand-50 transition-colors"
                      >
                        <FileText className="h-4.5 w-4.5 shrink-0 text-brand-400" aria-hidden />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-brand-900">{doc.title}</span>
                          {doc.updated_on && (
                            <span className="block text-[0.8rem] text-ink-400">
                              Updated {formatDate(doc.updated_on)}
                            </span>
                          )}
                        </span>
                        {doc.file_size ? (
                          <span className="text-[0.8rem] text-ink-400 tnum hidden sm:block">
                            {formatFileSize(doc.file_size)}
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
        )}
      </Section>
    </ContentPage>
  );
}
