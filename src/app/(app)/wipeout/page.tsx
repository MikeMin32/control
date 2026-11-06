import { Suspense } from "react";
import { WipeoutView } from "@/components/wipeout/wipeout-view";
import {
  ensureDefaultTemplate,
  listWipeoutQueue,
} from "@/lib/services/wipeout";
import { getOrCreateSettings } from "@/lib/services/settings";

export default async function WipeoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  await ensureDefaultTemplate();
  const [rows, settings] = await Promise.all([
    listWipeoutQueue(),
    getOrCreateSettings(),
  ]);

  const selected = sp.id ? rows.find((r) => r.id === sp.id) ?? null : null;

  return (
    <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
      <WipeoutView
        rows={rows}
        timezone={settings.displayTimezone}
        selected={selected}
      />
    </Suspense>
  );
}
