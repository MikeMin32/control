import { StatusPill } from "./status-pill";

/** @deprecated Prefer StatusPill — kept as thin wrapper for older call sites. */
export function StatusDot({
  colorClass,
  label,
  pillClass = "bg-sidebar text-ink",
}: {
  colorClass: string;
  label: string;
  pillClass?: string;
}) {
  return (
    <StatusPill label={label} dotClass={colorClass} pillClass={pillClass} />
  );
}
