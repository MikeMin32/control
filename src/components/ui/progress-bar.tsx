import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-sidebar",
        className,
      )}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full bg-mint-strong transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
