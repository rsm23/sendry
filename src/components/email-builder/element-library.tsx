import { useMemo, useState } from "react";
import {
  AlignJustify,
  AppWindow,
  BadgePercent,
  BadgeInfo,
  Box,
  Braces,
  Columns3,
  GalleryHorizontalEnd,
  Gauge,
  Heading,
  Image,
  LetterText,
  Link2,
  Menu,
  MessageSquareQuote,
  Minus,
  MousePointerClick,
  PackageOpen,
  CalendarDays,
  ChartNoAxesCombined,
  CircleUserRound,
  PanelTop,
  PlaySquare,
  Search,
  Share2,
  Space,
  Store,
  Timer,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/i18n/context";
import { EMAIL_BLOCK_DEFINITIONS, type EmailBlockCategory, type EmailBlockType } from "@/lib/email-builder";
import { Input } from "@/components/ui/input";

const icons: Record<EmailBlockType, LucideIcon> = {
  layout: PanelTop,
  heading: Heading,
  text: LetterText,
  image: Image,
  button: MousePointerClick,
  divider: Minus,
  spacer: Space,
  columns: Columns3,
  hero: GalleryHorizontalEnd,
  logo: AppWindow,
  social: Share2,
  menu: Menu,
  quote: MessageSquareQuote,
  video: PlaySquare,
  products: Store,
  coupon: BadgePercent,
  countdown: Timer,
  survey: Vote,
  feature: Gauge,
  stats: ChartNoAxesCombined,
  alert: BadgeInfo,
  event: CalendarDays,
  pricing: BadgePercent,
  signature: CircleUserRound,
  html: Braces,
  footer: AlignJustify,
};

const categories: Array<"All" | EmailBlockCategory> = ["All", "Layout", "Content", "Media", "Social", "Commerce", "Interactive", "Other"];

export function ElementLibrary({ onAdd, onDragStateChange, compact = false }: { onAdd: (type: EmailBlockType) => void; onDragStateChange?: (type: EmailBlockType | null) => void; compact?: boolean }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const filtered = useMemo(() => EMAIL_BLOCK_DEFINITIONS.filter((item) => {
    const matchesCategory = category === "All" || item.category === category;
    const query = search.trim().toLowerCase();
    return matchesCategory && (!query || `${item.label} ${item.description}`.toLowerCase().includes(query));
  }), [category, search]);

  return (
    <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-card">
      <div className="min-w-0 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search elements" aria-label="Search elements" />
        </div>
      </div>
      <div className={compact ? "flex min-h-0 min-w-0 flex-1 flex-col" : "grid min-h-0 min-w-0 flex-1 grid-cols-[5.5rem_minmax(0,1fr)]"}>
        <div className={compact ? "flex min-w-0 gap-1 overflow-x-auto border-b p-2" : "flex flex-col gap-0.5 border-e p-2"} role="list" aria-label="Element categories">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`shrink-0 rounded-md px-2.5 py-2 text-start text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${category === item ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"}`}
              onClick={() => setCategory(item)}
              aria-pressed={category === item}
            >
              {t(item)}
            </button>
          ))}
        </div>
        <div className={`grid min-w-0 content-start gap-2 overflow-y-auto p-3 ${compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2"}`}>
          {filtered.map((item) => {
            const Icon = icons[item.type];
            return (
              <button
                key={item.type}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("application/x-sendry-block-type", item.type);
                  event.dataTransfer.setData("text/plain", item.type);
                  onDragStateChange?.(item.type);
                }}
                onDragEnd={() => onDragStateChange?.(null)}
                onClick={() => onAdd(item.type)}
                className="group flex min-h-20 min-w-0 max-w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-md border bg-background px-1.5 py-3 text-center outline-none transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
                title={t(item.description)}
                aria-label={`${t("Add")} ${t(item.label)}`}
              >
                <span className="grid size-8 place-items-center rounded-md bg-muted text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"><Icon className="size-4" /></span>
                <span className="line-clamp-2 w-full min-w-0 max-w-full [hyphens:auto] [overflow-wrap:anywhere] text-[0.6875rem] font-medium leading-4">{t(item.label)}</span>
              </button>
            );
          })}
          {!filtered.length ? <div className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground"><PackageOpen className="size-5" /><span>No elements found</span></div> : null}
        </div>
      </div>
    </div>
  );
}

export function ElementIcon({ type, className }: { type: EmailBlockType; className?: string }) {
  const Icon = icons[type] ?? Box;
  return <Icon className={className} />;
}

export function LinkIcon({ className }: { className?: string }) {
  return <Link2 className={className} />;
}
