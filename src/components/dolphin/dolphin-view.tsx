"use client";

import {
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type {
  Company,
  DolphinAccount,
  Machine,
  Server,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CountryFlag } from "@/components/ui/country-flag";
import {
  createDolphinAction,
  deleteDolphinAction,
  updateDolphinAction,
} from "@/lib/actions";
import { StatusPill } from "@/components/ui/status-pill";
import {
  LIFECYCLE_DOT,
  LIFECYCLE_LABELS,
  LIFECYCLE_PILL,
} from "@/lib/labels";

type MachineOption = Machine & { server: Server; company: Company };

type AccountRow = DolphinAccount & {
  machine: MachineOption | null;
};

function machineLine(m: MachineOption | null | undefined) {
  if (!m) return null;
  const parts: ReactNode[] = [];
  parts.push(<span key="vmid">{m.vmid}</span>);
  if (m.displayName) {
    parts.push(<span key="sep1"> · </span>);
    parts.push(<span key="name">{m.displayName}</span>);
  }
  if (m.country) {
    parts.push(<span key="sep2"> · </span>);
    parts.push(
      <span key="flag" className="inline-flex items-center gap-1">
        <CountryFlag code={m.country} />
        <span>{m.country}</span>
      </span>,
    );
  }
  if (m.lifecycleStatus === "ARCHIVED" || m.archivedAt) {
    parts.push(<span key="sep3"> · </span>);
    parts.push(
      <span key="arch" className="text-muted">
        archived
      </span>,
    );
  }
  return <span className="inline-flex flex-wrap items-center gap-x-0.5">{parts}</span>;
}

function truncateWallet(addr: string, head = 8, tail = 6) {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function DolphinView({
  accounts,
  machines,
  initialQ,
}: {
  accounts: AccountRow[];
  machines: MachineOption[];
  initialQ: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(initialQ);
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<AccountRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<AccountRow | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const machineOptions = useMemo(
    () =>
      [...machines].sort(
        (a, b) => a.vmid - b.vmid || a.server.name.localeCompare(b.server.name),
      ),
    [machines],
  );

  async function copyWallet(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      setCopyToast("Wallet copied");
      setTimeout(() => setCopyToast(null), 2000);
    } catch {
      setCopyToast("Copy failed");
      setTimeout(() => setCopyToast(null), 2000);
    }
  }

  function runSearch(next: string) {
    const params = new URLSearchParams();
    if (next.trim()) params.set("q", next.trim());
    router.push(params.toString() ? `/dolphin?${params}` : "/dolphin");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Dolphin</h1>
          <p className="page-subtitle">
            Account records linked to VMs. No private keys — wallet address only.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add account
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input
          className="pl-9"
          placeholder="Search account, VM, or wallet"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch(e.currentTarget.value);
          }}
        />
      </div>

      {copyToast ? (
        <div
          className="rounded-slate border border-line bg-surface px-3 py-2 text-sm text-ink"
          role="status"
        >
          {copyToast}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-3 font-medium">Account name</th>
              <th className="px-4 py-3 font-medium">Linked VM</th>
              <th className="px-4 py-3 font-medium">Crypto wallet</th>
              <th className="px-4 py-3 font-medium">Network</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-muted"
                >
                  No Dolphin accounts yet.
                </td>
              </tr>
            ) : (
              accounts.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">
                    {row.accountName}
                  </td>
                  <td className="px-4 py-3">
                    {row.machine ? (
                      <div className="space-y-1">
                        <Link
                          href={`/machines?id=${row.machine.id}`}
                          className="text-ink underline-offset-2 hover:underline"
                        >
                          {machineLine(row.machine)}
                        </Link>
                        <div>
                          <StatusPill
                            label={LIFECYCLE_LABELS[row.machine.lifecycleStatus]}
                            dotClass={LIFECYCLE_DOT[row.machine.lifecycleStatus]}
                            pillClass={LIFECYCLE_PILL[row.machine.lifecycleStatus]}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.walletAddress ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-ink hover:underline"
                        title={row.walletAddress}
                        onClick={() => copyWallet(row.walletAddress!)}
                      >
                        {truncateWallet(row.walletAddress)}
                        <Copy className="h-3.5 w-3.5 text-muted" />
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {row.network || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${row.accountName}`}
                        onClick={() => {
                          setError(null);
                          setEditRow(row);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${row.accountName}`}
                        onClick={() => {
                          setError(null);
                          setDeleteRow(row);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

      <AccountFormDialog
        open={addOpen}
        title="Add Dolphin account"
        machines={machineOptions}
        pending={pending}
        error={error}
        onClose={() => setAddOpen(false)}
        onSubmit={(input) => {
          setError(null);
          startTransition(async () => {
            const res = await createDolphinAction(input);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setAddOpen(false);
            router.refresh();
          });
        }}
      />

      <AccountFormDialog
        open={Boolean(editRow)}
        title="Edit Dolphin account"
        machines={machineOptions}
        pending={pending}
        error={error}
        initial={editRow || undefined}
        onClose={() => setEditRow(null)}
        onSubmit={(input) => {
          if (!editRow) return;
          setError(null);
          startTransition(async () => {
            const res = await updateDolphinAction(editRow.id, input);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setEditRow(null);
            router.refresh();
          });
        }}
      />

      <Dialog
        open={Boolean(deleteRow)}
        onClose={() => setDeleteRow(null)}
        title="Delete Dolphin account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteRow(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending || !deleteRow}
              onClick={() => {
                if (!deleteRow) return;
                setError(null);
                startTransition(async () => {
                  const res = await deleteDolphinAction(deleteRow.id);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setDeleteRow(null);
                  router.refresh();
                });
              }}
            >
              Delete account
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Delete{" "}
          <span className="font-medium">{deleteRow?.accountName}</span>? This
          does not delete the linked VM.
        </p>
      </Dialog>
    </div>
  );
}

function AccountFormDialog({
  open,
  title,
  machines,
  pending,
  error,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  machines: MachineOption[];
  pending: boolean;
  error: string | null;
  initial?: AccountRow;
  onClose: () => void;
  onSubmit: (input: {
    accountName: string;
    machineId?: string | null;
    walletAddress?: string | null;
    network?: string | null;
    notes?: string | null;
  }) => void;
}) {
  const formId = initial ? "edit-dolphin-form" : "add-dolphin-form";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            form={formId}
            type="submit"
            disabled={pending}
          >
            {initial ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onSubmit({
            accountName: String(fd.get("accountName") || ""),
            machineId: String(fd.get("machineId") || "") || null,
            walletAddress: String(fd.get("walletAddress") || "") || null,
            network: String(fd.get("network") || "") || null,
            notes: String(fd.get("notes") || "") || null,
          });
        }}
      >
        <Field label="Account name">
          <Input
            name="accountName"
            required
            defaultValue={initial?.accountName || ""}
            key={initial?.id || "new-name"}
          />
        </Field>
        <Field label="Linked VM">
          <Select
            name="machineId"
            defaultValue={initial?.machineId || ""}
            key={initial?.id || "new-vm"}
          >
            <option value="">None</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.vmid}
                {m.displayName ? ` · ${m.displayName}` : ""}
                {m.country ? ` · ${m.country}` : ""}
                {m.lifecycleStatus === "ARCHIVED" || m.archivedAt
                  ? " (archived)"
                  : ""}
                {` · ${m.server.name}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Wallet address">
          <Input
            name="walletAddress"
            placeholder="0x… or chain address"
            defaultValue={initial?.walletAddress || ""}
            key={initial?.id || "new-wallet"}
          />
        </Field>
        <Field label="Network">
          <Input
            name="network"
            placeholder="e.g. ETH, SOL"
            defaultValue={initial?.network || ""}
            key={initial?.id || "new-net"}
          />
        </Field>
        <Field label="Notes">
          <Textarea
            name="notes"
            rows={2}
            defaultValue={initial?.notes || ""}
            key={initial?.id || "new-notes"}
          />
        </Field>
        {error && open ? (
          <p className="text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
