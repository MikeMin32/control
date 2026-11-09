import { DolphinView } from "@/components/dolphin/dolphin-view";
import {
  listDolphinAccounts,
  listLinkableMachines,
} from "@/lib/services/dolphin";
import { serializeProxy } from "@/lib/utils";

export default async function DolphinPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const [accounts, machines] = await Promise.all([
    listDolphinAccounts({ q: sp.q }),
    listLinkableMachines(),
  ]);

  const serialized = accounts.map((row) => ({
    ...row,
    proxyAssignments: row.proxyAssignments.map((a) => ({
      ...a,
      proxy: serializeProxy(a.proxy),
    })),
  }));

  return (
    <DolphinView
      accounts={serialized}
      machines={machines}
      initialQ={sp.q || ""}
    />
  );
}
