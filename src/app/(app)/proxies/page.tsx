import { ProxiesView } from "@/components/proxies/proxies-view";
import {
  listProxies,
  listUnresolvedCancellations,
} from "@/lib/services/proxies";

export default async function ProxiesPage() {
  const [proxies, pendingCancellations] = await Promise.all([
    listProxies(),
    listUnresolvedCancellations(),
  ]);
  return (
    <ProxiesView
      proxies={proxies}
      pendingCancellations={pendingCancellations}
    />
  );
}
