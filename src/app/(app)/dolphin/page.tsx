import { DolphinView } from "@/components/dolphin/dolphin-view";
import {
  listDolphinAccounts,
  listLinkableMachines,
} from "@/lib/services/dolphin";

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

  return (
    <DolphinView
      accounts={accounts}
      machines={machines}
      initialQ={sp.q || ""}
    />
  );
}
