import type { MetadataRoute } from "next";
import { getGalas, getNews, getSeries } from "@/lib/queries";
import { NAV } from "@/lib/nav";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://carnforthotters.co.uk").replace(/\/$/, "");

  const staticPaths = [
    "/", "/results", "/live", "/newsletters", "/news", "/join", "/contact", "/privacy",
    ...NAV.flatMap((g) => [g.href, ...g.links.map((l) => l.href)]),
  ];

  const entries: MetadataRoute.Sitemap = [...new Set(staticPaths)].map((path) => ({
    url: `${base}${path === "/" ? "" : path}`,
    lastModified: new Date(),
    changeFrequency: path === "/" || path === "/live" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));

  const [galas, series, news] = await Promise.all([
    getGalas({ limit: 200 }),
    getSeries(),
    getNews(200),
  ]);

  for (const s of series) {
    entries.push({
      url: `${base}/results/series/${s.slug}`,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }
  for (const gala of galas) {
    entries.push({
      url: `${base}/results/${gala.slug}`,
      lastModified: gala.imported_at ? new Date(gala.imported_at) : undefined,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }
  for (const post of news) {
    entries.push({
      url: `${base}/news/${post.slug}`,
      lastModified: new Date(post.published_at),
      changeFrequency: "yearly",
      priority: 0.5,
    });
  }

  return entries;
}
