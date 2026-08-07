import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { PageHero, Prose, Section } from "@/components/ui";
import { getNews, getNewsPost } from "@/lib/queries";
import { formatDate, markdownToHtml } from "@/lib/format";

export const revalidate = 120;

export async function generateStaticParams() {
  const posts = await getNews(50);
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getNewsPost(slug);
  if (!post) return { title: "Post not found" };
  return {
    title: post.title,
    description: post.excerpt ?? undefined,
    openGraph: post.image_url ? { images: [post.image_url] } : undefined,
  };
}

export default async function NewsPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getNewsPost(slug);
  if (!post) notFound();

  return (
    <>
      <PageHero
        breadcrumbs={[{ href: "/news", label: "News" }]}
        eyebrow={formatDate(post.published_at)}
        title={post.title}
        intro={post.excerpt}
      />
      <Section title="">
        {post.image_url && (
          <Image
            src={post.image_url}
            alt=""
            width={1200}
            height={630}
            className="w-full max-w-3xl rounded-2xl object-cover mb-9"
            unoptimized
          />
        )}
        <Prose html={markdownToHtml(post.body)} />
        <div className="mt-12">
          <Link href="/news" className="btn btn-ghost btn-sm">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            All news
          </Link>
        </div>
      </Section>
    </>
  );
}
