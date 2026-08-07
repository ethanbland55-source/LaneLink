import Link from "next/link";
import type { Metadata } from "next";
import Image from "next/image";
import { ArrowRight, Newspaper } from "lucide-react";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getNews } from "@/lib/queries";
import { formatDate } from "@/lib/format";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Club news",
  description: "Announcements, gala reports and results round-ups from Carnforth & District Otters ASC.",
};

export default async function NewsPage() {
  const posts = await getNews();

  return (
    <>
      <PageHero
        eyebrow="Club"
        title="News"
        intro="Announcements, gala reports and results round-ups from around the club."
      />
      <Section title="">
        {posts.length === 0 ? (
          <EmptyState
            icon={<Newspaper className="h-6 w-6" />}
            title="No posts yet"
            message="Club news will appear here. In the meantime, the newsletter has everything."
            action={<Link href="/newsletters" className="btn btn-brand btn-sm">Read the newsletter</Link>}
          />
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/news/${post.slug}`}
                className="card card-hover group overflow-hidden flex flex-col"
              >
                {post.image_url && (
                  <Image
                    src={post.image_url}
                    alt=""
                    width={640}
                    height={360}
                    className="h-44 w-full object-cover"
                    unoptimized
                  />
                )}
                <div className="p-6 flex flex-col flex-1">
                  <p className="text-[0.78rem] uppercase tracking-wider text-ink-400 font-semibold">
                    {formatDate(post.published_at)}
                  </p>
                  <h2 className="mt-2.5 text-lg group-hover:text-brand-600 transition-colors">
                    {post.title}
                  </h2>
                  {post.excerpt && (
                    <p className="mt-2 text-[0.92rem] text-ink-600 flex-1">{post.excerpt}</p>
                  )}
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-brand-700 group-hover:gap-2.5 transition-all">
                    Read more
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
