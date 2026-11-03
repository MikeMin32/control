import { cn } from "@/lib/utils";

/** Outline cube mark matching the SLATE sidebar brand. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("h-7 w-7 text-ink", className)}
    >
      <path
        d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 3.5 12 12M12 12l7.5-4M12 12l-7.5-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
