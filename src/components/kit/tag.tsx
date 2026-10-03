import { cn } from "@/lib/utils"
export type TagColor = "blue" | "purple" | "green" | "moss" | "red" | "orange" | "amber" | "teal" | "yellow" | "neutral"

const palette: Record<TagColor, string> = {
  blue: "border-(--tag-blue-border) bg-(--tag-blue-bg) text-(--tag-blue-text)",
  purple: "border-(--tag-purple-border) bg-(--tag-purple-bg) text-(--tag-purple-text)",
  green: "border-(--tag-green-border) bg-(--tag-green-bg) text-(--tag-green-text)",
  moss: "border-(--tag-moss-border) bg-(--tag-moss-bg) text-(--tag-moss-text)",
  red: "border-(--tag-red-border) bg-(--tag-red-bg) text-(--tag-red-text)",
  orange: "border-(--tag-orange-border) bg-(--tag-orange-bg) text-(--tag-orange-text)",
  amber: "border-(--tag-amber-border) bg-(--tag-amber-bg) text-(--tag-amber-text)",
  teal: "border-(--tag-teal-border) bg-(--tag-teal-bg) text-(--tag-teal-text)",
  yellow: "border-(--tag-yellow-border) bg-(--tag-yellow-bg) text-(--tag-yellow-text)",
  neutral: "border-(--tag-neutral-border) bg-(--tag-neutral-bg) text-(--tag-neutral-text)",
}

export function Tag({
  color = "neutral",
  size = "md",
  className,
  children,
}: {
  color?: TagColor
  size?: "sm" | "md"
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1 rounded-full border leading-none whitespace-nowrap",
        size === "md" ? "h-[22px] px-2 text-[14px]" : "h-[18px] px-1.5 text-[12px]",
        palette[color],
        className,
      )}
    >
      {children}
    </span>
  )
}

export type TagItem = { label: string; color: TagColor }

/** Shows the first `max` tags and collapses the rest into a neutral "+N", like the reference. */
export function TagList({ items, max = 2, size }: { items: TagItem[]; max?: number; size?: "sm" | "md" }) {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length
  return (
    <span className="flex items-center gap-[3px]">
      {shown.map((t) => (
        <Tag key={t.label} color={t.color} size={size}>
          {t.label}
        </Tag>
      ))}
      {rest > 0 ? <Tag size={size}>+{rest}</Tag> : null}
    </span>
  )
}

/** Stable color for free-form labels (client tags, categories). */
export function colorFor(label: string): TagColor {
  const colors: TagColor[] = ["blue", "purple", "green", "orange", "amber", "teal", "yellow", "moss", "red"]
  let h = 0
  for (const ch of label.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}
