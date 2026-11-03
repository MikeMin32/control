import { Suspense } from "react";
import { MachinesView } from "@/components/machines/machines-view";
import { listMachines, getMachine } from "@/lib/services/machines";
import { listServers, listCompanies, getOrCreateSettings } from "@/lib/services/settings";
import { listProxies } from "@/lib/services/proxies";
import type { LifecycleStatus } from "@prisma/client";

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const serverId = sp.serverId || null;
  const q = sp.q || "";
  const status = (sp.status as LifecycleStatus | undefined) || undefined;
  const page = Number(sp.page || 1);
  const id = sp.id;

  const [list, servers, companies, availableProxies, settings] =
    await Promise.all([
      listMachines({
        serverId,
        q,
        status: status || "ALL",
        page,
        pageSize: 25,
      }),
      listServers(),
      listCompanies(),
      listProxies({ availability: "AVAILABLE" }),
      getOrCreateSettings(),
    ]);

  let selected = null;
  if (id) {
    try {
      selected = await getMachine(id);
    } catch {
      selected = null;
    }
  }

  return (
    <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
      <MachinesView
        machines={list.items}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        servers={servers}
        companies={companies}
        availableProxies={availableProxies}
        timezone={settings.displayTimezone}
        selected={selected}
        initialServerId={serverId || ""}
        initialQ={q}
        initialStatus={status || ""}
      />
    </Suspense>
  );
}
