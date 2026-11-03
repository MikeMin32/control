import { cn } from "@/lib/utils";

export function StatusDot({
  colorClass,
  label,
}: {
  colorClass: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", colorClass)}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}
