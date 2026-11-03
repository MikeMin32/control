"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Copy,
  MoreHorizontal,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
} from "lucide-react";
import type {
  Company,
  LifecycleStatus,
  Machine,
  Proxy,
  ProxyAssignment,
  Server,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import {
  createCompanyInlineAction,
  createMachineAction,
  markBurnedAction,
  migrateMachineAction,
  rotateProxyAction,
  startClosureAction,
  updateMachineAction,
} from "@/lib/actions";
import {
  LIFECYCLE_DOT,
  LIFECYCLE_LABELS,
  LIFECYCLE_PILL,
} from "@/lib/labels";
import type { ProxmoxStatus } from "@/lib/proxmox";
import {
  cn,
  formatCalendarDateLong,
  formatDate,
  isRenewalOverdue,
} from "@/lib/utils";

type MachineRow = Machine & {
  server: Server;
  company: Company;
  proxyAssignments: (ProxyAssignment & { proxy: Proxy })[];
};

type DetailMachine = MachineRow & {
  proxyAssignments: (ProxyAssignment & { proxy: Proxy })[];
  migrations: {
    id: string;
    fromVmid: number;
    toVmid: number;
    createdAt: Date | string;
    fromServer: Server;
    toServer: Server;
    note: string | null;
  }[];
  activities: {
    id: string;
    type: string;
    message: string;
    createdAt: Date | string;
    actor: { email: string } | null;
  }[];
  closure: {
    id: string;
    reason: string;
    items: { id: string; label: string; status: string; required: boolean }[];
  } | null;
};

export function MachinesView({
  machines,
  total,
  page,
  pageSize,
  servers,
  companies,
  availableProxies,
  timezone,
  selected,
  initialServerId,
  initialQ,
  initialStatus,
  serverCounts,
  allCount,
  proxmox,
}: {
  machines: MachineRow[];
  total: number;
  page: number;
  pageSize: number;
  servers: Server[];
  companies: Company[];
  availableProxies: Proxy[];
  timezone: string;
  selected: DetailMachine | null;
  initialServerId: string;
  initialQ: string;
  initialStatus: string;
  serverCounts: Record<string, number>;
  allCount: number;
  proxmox: ProxmoxStatus;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "proxy" | "activity">("overview");
  const [rotateOpen, setRotateOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  const activeServers = useMemo(
    () => servers.filter((s) => !s.retiredAt),
    [servers],
  );

  const selectedServer = activeServers.find((s) => s.id === initialServerId);

  function setQuery(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    if (!("page" in patch)) sp.delete("page");
    router.push(`/machines?${sp.toString()}`);
  }

  function openMachine(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("id", id);
    router.push(`/machines?${sp.toString()}`);
  }

  function closeDrawer() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("id");
    router.push(`/machines?${sp.toString()}`);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Machines</h1>
          <p className="page-subtitle">
            Manage Proxmox virtual machines across your servers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          </Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add VM
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ServerTabPill
          active={!initialServerId}
          onClick={() => setQuery({ serverId: null })}
          label="All servers"
          count={allCount}
        />
        {activeServers.map((s) => (
          <ServerTabPill
            key={s.id}
            active={initialServerId === s.id}
            onClick={() => setQuery({ serverId: s.id })}
            label={s.name}
            count={serverCounts[s.id] ?? 0}
          />
        ))}
      </div>

      {selectedServer ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
          <div>
            <div className="text-lg font-semibold tracking-tight text-ink">
              {selectedServer.name}
            </div>
            <div className="text-sm text-muted">
              {serverCounts[selectedServer.id] ?? 0} VMs
              {proxmox.state !== "not_configured"
                ? ` · Proxmox ${proxmox.state === "connected" ? "connected" : "unreachable"}`
                : ""}
            </div>
          </div>
          {proxmox.state === "connected" ? (
            <StatusPill
              label="Online"
              dotClass="bg-[#2f9e5f]"
              pillClass="bg-[#e5f5ea] text-[#1a4a2e]"
            />
          ) : proxmox.state === "unreachable" ? (
            <StatusPill
              label="Unreachable"
              dotClass="bg-[#c45c5c]"
              pillClass="bg-[#fce8e8] text-[#8a3030]"
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            placeholder="Search VMID, name, company, proxy IP"
            defaultValue={initialQ}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setQuery({ q: e.currentTarget.value || null });
              }
            }}
          />
        </div>
        <Select
          className="w-44"
          value={initialStatus || "ALL"}
          onChange={(e) =>
            setQuery({
              status: e.target.value === "ALL" ? null : e.target.value,
            })
          }
        >
          <option value="ALL">All statuses</option>
          {Object.entries(LIFECYCLE_LABELS)
            .filter(([k]) => k !== "ARCHIVED")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-3 font-medium">VM</th>
              <th className="px-4 py-3 font-medium">Company</th>
              {!initialServerId ? (
                <th className="px-4 py-3 font-medium">Server</th>
              ) : null}
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Proxy IP</th>
              <th className="px-4 py-3 font-medium">Renewal</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-14 text-center text-muted"
                >
                  No machines match these filters.
                </td>
              </tr>
            ) : (
              machines.map((m) => {
                const current = m.proxyAssignments[0]?.proxy;
                const overdue = isRenewalOverdue(current?.renewalDate ?? null);
                return (
                  <tr
                    key={m.id}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-sidebar/50"
                    onClick={() => openMachine(m.id)}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-slate border border-line bg-sidebar text-muted">
                          <Monitor className="h-4 w-4" strokeWidth={1.6} />
                        </span>
                        <div>
                          <div className="font-semibold tabular-nums text-ink">
                            {m.vmid}
                          </div>
                          {m.displayName ? (
                            <div className="text-xs text-muted">
                              {m.displayName}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-ink">{m.company.name}</td>
                    {!initialServerId ? (
                      <td className="px-4 py-3.5 text-ink">{m.server.name}</td>
                    ) : null}
                    <td className="px-4 py-3.5">
                      <StatusPill
                        label={LIFECYCLE_LABELS[m.lifecycleStatus]}
                        dotClass={LIFECYCLE_DOT[m.lifecycleStatus]}
                        pillClass={LIFECYCLE_PILL[m.lifecycleStatus]}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      {current ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(current.ip);
                          }}
                        >
                          {current.ip}
                          <Copy className="h-3 w-3 text-muted" />
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {current?.renewalDate ? (
                        <span
                          className={
                            overdue ? "text-[#8a3030]" : "text-ink"
                          }
                          title={
                            overdue
                              ? "Proxy renewal overdue (lifecycle unchanged)"
                              : undefined
                          }
                        >
                          {formatCalendarDateLong(current.renewalDate)}
                          {overdue ? (
                            <span className="ml-1 text-xs">· overdue</span>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="relative px-4 py-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Row actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRowMenu(rowMenu === m.id ? null : m.id);
                        }}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      {rowMenu === m.id ? (
                        <div
                          className="absolute right-4 z-20 mt-1 w-40 overflow-hidden rounded-slate border border-line bg-surface text-left shadow-soft"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-sm hover:bg-sidebar"
                            onClick={() => {
                              setRowMenu(null);
                              openMachine(m.id);
                            }}
                          >
                            Open details
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          {total} result{total === 1 ? "" : "s"}
        </span>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={(p) => setQuery({ page: String(p) })}
        />
      </div>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add VM"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending}
              form="add-vm-form"
              type="submit"
            >
              Create
            </Button>
          </>
        }
      >
        <form
          id="add-vm-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              let companyId = String(fd.get("companyId") || "");
              const newCompany = String(fd.get("newCompany") || "").trim();
              if (newCompany) {
                const created = await createCompanyInlineAction(newCompany);
                if (!created.ok) {
                  setError(created.error);
                  return;
                }
                companyId = created.id!;
              }
              const res = await createMachineAction({
                vmid: Number(fd.get("vmid")),
                displayName: String(fd.get("displayName") || "") || undefined,
                serverId: String(fd.get("serverId")),
                companyId,
                lifecycleStatus: String(
                  fd.get("lifecycleStatus"),
                ) as LifecycleStatus,
                internalIp: String(fd.get("internalIp") || "") || undefined,
                os: String(fd.get("os") || "") || undefined,
                notes: String(fd.get("notes") || "") || undefined,
              });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setAddOpen(false);
              router.refresh();
              if (res.id) openMachine(res.id);
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="VMID">
              <Input name="vmid" type="number" required min={1} />
            </Field>
            <Field label="Display name">
              <Input name="displayName" />
            </Field>
          </div>
          <Field label="Server">
            <Select
              name="serverId"
              required
              defaultValue={initialServerId || activeServers[0]?.id}
            >
              {activeServers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Company">
            <Select name="companyId" defaultValue={companies[0]?.id}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Or create company">
            <Input name="newCompany" placeholder="New company name" />
          </Field>
          <Field label="Lifecycle">
            <Select name="lifecycleStatus" defaultValue="PREPARING">
              {Object.entries(LIFECYCLE_LABELS)
                .filter(([k]) => !["ARCHIVED", "BURNED"].includes(k))
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Internal IP">
              <Input name="internalIp" />
            </Field>
            <Field label="OS">
              <Input name="os" />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea name="notes" rows={2} />
          </Field>
          {error ? (
            <p className="text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Dialog>

      <Drawer
        open={Boolean(selected)}
        onClose={closeDrawer}
        title={
          selected
            ? `VM ${selected.vmid}${selected.displayName ? ` · ${selected.displayName}` : ""}`
            : "VM"
        }
        wide
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex gap-1 border-b border-line">
              {(
                [
                  ["overview", "Overview"],
                  ["proxy", "Proxy history"],
                  ["activity", "Activity"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`px-3 py-2 text-sm ${
                    tab === id
                      ? "border-b-2 border-ink font-medium text-ink"
                      : "text-muted"
                  }`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" ? (
              <Overview
                machine={selected}
                companies={companies}
                timezone={timezone}
                pending={pending}
                onSave={(input) => {
                  setError(null);
                  startTransition(async () => {
                    const res = await updateMachineAction(selected.id, input);
                    if (!res.ok) setError(res.error);
                    else router.refresh();
                  });
                }}
                onBurned={() => {
                  startTransition(async () => {
                    const res = await markBurnedAction(selected.id);
                    if (!res.ok) setError(res.error);
                    else {
                      router.push("/wipeout");
                      router.refresh();
                    }
                  });
                }}
                onExpireClosure={() => {
                  startTransition(async () => {
                    const res = await startClosureAction(
                      selected.id,
                      "EXPIRED",
                    );
                    if (!res.ok) setError(res.error);
                    else {
                      router.push("/wipeout");
                      router.refresh();
                    }
                  });
                }}
                onRotate={() => setRotateOpen(true)}
                onMigrate={() => setMigrateOpen(true)}
                error={error}
              />
            ) : null}

            {tab === "proxy" ? (
              <ProxyHistory assignments={selected.proxyAssignments} />
            ) : null}

            {tab === "activity" ? (
              <ActivityList items={selected.activities} timezone={timezone} />
            ) : null}

            <Dialog
              open={rotateOpen}
              onClose={() => setRotateOpen(false)}
              title="Rotate proxy"
              footer={
                <>
                  <Button variant="ghost" onClick={() => setRotateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    form="rotate-form"
                    type="submit"
                    disabled={pending}
                  >
                    Confirm rotate
                  </Button>
                </>
              }
            >
              <p className="mb-3 text-sm text-muted">
                Records a proxy replacement in the database only. Does not
                change GOST, SSH, or provider billing.
              </p>
              <form
                id="rotate-form"
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  startTransition(async () => {
                    const res = await rotateProxyAction(selected.id, {
                      proxyId: String(fd.get("proxyId")),
                      reason: String(fd.get("reason")),
                    });
                    if (!res.ok) setError(res.error);
                    else {
                      setRotateOpen(false);
                      router.refresh();
                    }
                  });
                }}
              >
                <Field label="Current">
                  <Input
                    disabled
                    value={
                      selected.proxyAssignments.find((a) => !a.endedAt)?.proxy
                        .ip || "None"
                    }
                  />
                </Field>
                <Field label="New proxy">
                  <Select name="proxyId" required>
                    {availableProxies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.ip} · {p.provider}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reason">
                  <Input
                    name="reason"
                    required
                    placeholder="Replacement reason"
                  />
                </Field>
              </form>
            </Dialog>

            <Dialog
              open={migrateOpen}
              onClose={() => setMigrateOpen(false)}
              title="Migrate VM"
              footer={
                <>
                  <Button variant="ghost" onClick={() => setMigrateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    form="migrate-form"
                    type="submit"
                    disabled={pending}
                  >
                    Migrate
                  </Button>
                </>
              }
            >
              <form
                id="migrate-form"
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  startTransition(async () => {
                    const res = await migrateMachineAction(selected.id, {
                      toServerId: String(fd.get("toServerId")),
                      toVmid: Number(fd.get("toVmid")),
                      note: String(fd.get("note") || "") || undefined,
                    });
                    if (!res.ok) setError(res.error);
                    else {
                      setMigrateOpen(false);
                      router.refresh();
                    }
                  });
                }}
              >
                <Field label="Target server">
                  <Select
                    name="toServerId"
                    required
                    defaultValue={selected.serverId}
                  >
                    {activeServers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Target VMID">
                  <Input
                    name="toVmid"
                    type="number"
                    required
                    min={1}
                    defaultValue={selected.vmid}
                  />
                </Field>
                <Field label="Note">
                  <Input name="note" />
                </Field>
              </form>
            </Dialog>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function ServerTabPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-slate border px-3 py-2 text-sm transition",
        active
          ? "border-transparent bg-sidebar-active font-medium text-ink"
          : "border-line bg-surface text-muted hover:bg-sidebar/80 hover:text-ink",
      )}
    >
      <ServerIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span>{label}</span>
      <span
        className={cn(
          "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium",
          active ? "bg-surface text-ink" : "bg-sidebar text-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

function Overview({
  machine,
  companies,
  timezone,
  pending,
  onSave,
  onBurned,
  onExpireClosure,
  onRotate,
  onMigrate,
  error,
}: {
  machine: DetailMachine;
  companies: Company[];
  timezone: string;
  pending: boolean;
  onSave: (input: {
    displayName?: string | null;
    companyId?: string;
    lifecycleStatus?: LifecycleStatus;
    internalIp?: string | null;
    os?: string | null;
    notes?: string | null;
  }) => void;
  onBurned: () => void;
  onExpireClosure: () => void;
  onRotate: () => void;
  onMigrate: () => void;
  error: string | null;
}) {
  const current = machine.proxyAssignments.find((a) => !a.endedAt)?.proxy;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          displayName: String(fd.get("displayName") || "") || null,
          companyId: String(fd.get("companyId")),
          lifecycleStatus: String(fd.get("lifecycleStatus")) as LifecycleStatus,
          internalIp: String(fd.get("internalIp") || "") || null,
          os: String(fd.get("os") || "") || null,
          notes: String(fd.get("notes") || "") || null,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted">Server</div>
          <div>{machine.server.name}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Created</div>
          <div>{formatDate(machine.createdAt, timezone)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Current proxy</div>
          <div className="font-mono text-xs">{current?.ip || "—"}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Status</div>
          <StatusPill
            label={LIFECYCLE_LABELS[machine.lifecycleStatus]}
            dotClass={LIFECYCLE_DOT[machine.lifecycleStatus]}
            pillClass={LIFECYCLE_PILL[machine.lifecycleStatus]}
          />
        </div>
      </div>
      <Field label="Display name">
        <Input name="displayName" defaultValue={machine.displayName || ""} />
      </Field>
      <Field label="Company">
        <Select name="companyId" defaultValue={machine.companyId}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Lifecycle">
        <Select name="lifecycleStatus" defaultValue={machine.lifecycleStatus}>
          {Object.entries(LIFECYCLE_LABELS)
            .filter(([k]) => k !== "ARCHIVED")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Internal IP">
          <Input name="internalIp" defaultValue={machine.internalIp || ""} />
        </Field>
        <Field label="OS">
          <Input name="os" defaultValue={machine.os || ""} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea name="notes" defaultValue={machine.notes || ""} />
      </Field>
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button type="submit" variant="primary" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="outline" onClick={onRotate}>
          Rotate proxy
        </Button>
        <Button type="button" variant="outline" onClick={onMigrate}>
          Migrate
        </Button>
        <Button type="button" variant="danger" onClick={onBurned}>
          Mark burned
        </Button>
        {machine.lifecycleStatus === "EXPIRED" && !machine.closure ? (
          <Button type="button" variant="outline" onClick={onExpireClosure}>
            Start wipeout
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Mark burned opens a manual wipeout checklist. Ticking items does not
        delete external resources.
      </p>
    </form>
  );
}

function ProxyHistory({
  assignments,
}: {
  assignments: (ProxyAssignment & { proxy: Proxy })[];
}) {
  if (assignments.length === 0) {
    return <p className="text-sm text-muted">No proxy history yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {assignments.map((a) => (
        <li key={a.id} className="rounded-slate border border-line p-3 text-sm">
          <div className="font-mono text-xs">{a.proxy.ip}</div>
          <div className="mt-1 text-muted">
            {a.proxy.provider}
            {a.endedAt ? "" : " · current"}
          </div>
          <div className="mt-1 text-xs text-muted">
            {formatCalendarDateLong(a.startedAt)} →{" "}
            {a.endedAt ? formatCalendarDateLong(a.endedAt) : "present"}
            {a.reason ? ` · ${a.reason}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityList({
  items,
  timezone,
}: {
  items: DetailMachine["activities"];
  timezone: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">No activity yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li
          key={a.id}
          className="border-b border-line pb-3 text-sm last:border-0"
        >
          <div>{a.message}</div>
          <div className="mt-1 text-xs text-muted">
            {formatDate(a.createdAt, timezone)}
            {a.actor ? ` · ${a.actor.email}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}
