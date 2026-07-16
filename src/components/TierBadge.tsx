import { cn } from "@/utils";

type Tier = "free" | "paid" | "unknown";

interface Props {
  tier?: Tier;
  size?: "sm" | "xs";
  className?: string;
}

export function TierBadge({ tier, size = "sm", className }: Props) {
  if (!tier || tier === "unknown") return null;

  const base =
    size === "xs"
      ? "text-[8px] px-1.5 py-[1px]"
      : "text-[9px] px-2 py-0.5";

  if (tier === "free") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
          base,
          className
        )}
      >
        <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
        Free
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-500",
        base,
        className
      )}
    >
      Paid
    </span>
  );
}
