import { Suspense } from "react";
import { ArchiveView } from "@/components/archive/archive-view";
import { listArchive } from "@/lib/services/wipeout";
import { getOrCreateSettings } from "@/lib/services/settings";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = sp.q || "";
  const [rows, settings] = await Promise.all([
    listArchive({ q }),
    getOrCreateSettings(),
  ]);
  const selected = sp.id ? rows.find((r) => r.id === sp.id) || null : null;

  return (
    <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
      <ArchiveView
        rows={rows}
        timezone={settings.displayTimezone}
        selected={selected}
        q={q}
      />
    </Suspense>
  );
}
