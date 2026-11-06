import { ProxiesView } from "@/components/proxies/proxies-view";
import {
  listProxies,
  listUnresolvedCancellations,
} from "@/lib/services/proxies";
import { serializeProxy } from "@/lib/utils";

export default async function ProxiesPage() {
  const [proxies, pendingCancellations] = await Promise.all([
    listProxies(),
    listUnresolvedCancellations(),
  ]);
  return (
    <ProxiesView
      proxies={proxies.map(serializeProxy)}
      pendingCancellations={pendingCancellations.map(serializeProxy)}
    />
  );
}
