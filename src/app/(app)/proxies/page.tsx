import { ProxiesView } from "@/components/proxies/proxies-view";
import {
  listProxies,
  listUnresolvedCancellations,
} from "@/lib/services/proxies";
import { listActiveDolphinAccounts } from "@/lib/services/dolphin";
import { serializeProxy } from "@/lib/utils";

export default async function ProxiesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "dolphin" ? "dolphin" : "vm";
  const kind = tab === "dolphin" ? "DOLPHIN" : "VM";

  const [proxies, pendingCancellations, dolphins] = await Promise.all([
    listProxies({ kind }),
    listUnresolvedCancellations(),
    listActiveDolphinAccounts(),
  ]);

  const pendingForTab = pendingCancellations.filter((p) => p.kind === kind);

  return (
    <ProxiesView
      tab={tab}
      proxies={proxies.map(serializeProxy)}
      pendingCancellations={pendingForTab.map(serializeProxy)}
      dolphins={dolphins}
    />
  );
}
