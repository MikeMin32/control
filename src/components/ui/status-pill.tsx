import { cn } from "@/lib/utils";

export function StatusPill({
  label,
  dotClass,
  pillClass,
  className,
}: {
  label: string;
  dotClass: string;
  pillClass: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium",
        pillClass,
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)}
        aria-hidden
      />
      {label}
    </span>
  );
}
