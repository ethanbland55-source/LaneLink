import Link from "next/link";
import { CalendarDays, MapPin, ArrowRight } from "lucide-react";
import type { Gala } from "@/lib/types";
import { courseLabel, formatDateRange, galaStatus, meetTypeLabel } from "@/lib/format";
import { Badge } from "./ui";

const STATUS_TONE = {
  live: "live",
  upcoming: "brand",
  recent: "gold",
  archived: "muted",
} as const;

const STATUS_LABEL = {
  live: "Live now",
  upcoming: "Upcoming",
  recent: "Results in",
  archived: "Archive",
} as const;

export default function GalaCard({ gala, showSeries = true }: { gala: Gala; showSeries?: boolean }) {
  const status = galaStatus(gala);
  const href = `/results/${gala.slug}`;

  return (
    <Link
      href={href}
      className="card card-hover group flex flex-col p-6 h-full focus-visible:outline-gold-500"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[status]}>
          {status === "live" && <span className="live-dot" aria-hidden />}
          {STATUS_LABEL[status]}
        </Badge>
        {showSeries && gala.series?.name && <Badge tone="muted">{gala.series.name}</Badge>}
        {!gala.is_home && <Badge tone="muted">Away</Badge>}
      </div>

      <h3 className="mt-4 text-xl group-hover:text-brand-600 transition-colors">{gala.name}</h3>

      <dl className="mt-4 space-y-2 text-[0.9rem] text-ink-600">
        {gala.start_date && (
          <div className="flex items-start gap-2.5">
            <CalendarDays className="h-4 w-4 mt-0.5 shrink-0 text-brand-400" aria-hidden />
            <dd>{formatDateRange(gala.start_date, gala.end_date)}</dd>
          </div>
        )}
        {gala.venue && (
          <div className="flex items-start gap-2.5">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-brand-400" aria-hidden />
            <dd>{gala.venue}</dd>
          </div>
        )}
      </dl>

      <div className="mt-auto pt-5 flex items-center justify-between gap-3">
        <span className="text-[0.78rem] uppercase tracking-wider text-ink-400 font-medium">
          {[meetTypeLabel(gala.meet_type), courseLabel(gala.course).replace(/ \(.*\)/, "")]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-brand-700 group-hover:gap-2.5 transition-all">
          {status === "upcoming" ? "Details" : "Results"}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
