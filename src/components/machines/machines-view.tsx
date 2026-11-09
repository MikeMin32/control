"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Copy,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
} from "lucide-react";
import type {
  LifecycleStatus,
  Machine,
  Proxy,
  ProxyAssignment,
  Server,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { CountrySelect } from "@/components/ui/country-select";
import { Drawer } from "@/components/ui/drawer";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import {
  createMachineAction,
  markBurnedAction,
  migrateMachineAction,
  rotateProxyAction,
  startSetupAction,
  updateMachineAction,
} from "@/lib/actions";
import { SetupChecklistPanel } from "@/components/setup/setup-checklist-panel";
import { countryName } from "@/lib/countries";
import {
  LIFECYCLE_CREATE_STATUSES,
  LIFECYCLE_DOT,
  LIFECYCLE_LABELS,
  LIFECYCLE_PILL,
  LIFECYCLE_UI_STATUSES,
} from "@/lib/labels";
import type { ProxmoxStatus } from "@/lib/proxmox";
import {
  cn,
  formatCalendarDateLong,
  formatDate,
  isRenewalOverdue,
} from "@/lib/utils";
import type { SetupChecklist, SetupChecklistItem } from "@prisma/client";

type SetupBundle = SetupChecklist & { items: SetupChecklistItem[] };

type MachineRow = Machine & {
  server: Server;
  proxyAssignments: (ProxyAssignment & { proxy: Proxy })[];
  closure?: {
    id: string;
    completedAt: Date | string | null;
  } | null;
  setupChecklist?: SetupBundle | null;
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
    completedAt?: Date | string | null;
    items: { id: string; label: string; status: string; required: boolean }[];
  } | null;
  setupChecklist: SetupBundle | null;
};

export function MachinesView({
  machines,
  total,
  page,
  pageSize,
  servers,
  availableProxies,
  timezone,
  selected,
  initialServerId,
  initialQ,
  initialStatus,
  initialTab,
  serverCounts,
  allCount,
  proxmox,
}: {
  machines: MachineRow[];
  total: number;
  page: number;
  pageSize: number;
  servers: Server[];
  availableProxies: Proxy[];
  timezone: string;
  selected: DetailMachine | null;
  initialServerId: string;
  initialQ: string;
  initialStatus: string;
  initialTab: string;
  serverCounts: Record<string, number>;
  allCount: number;
  proxmox: ProxmoxStatus;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "setup" | "proxy" | "activity">(
    initialTab === "setup" ||
      initialTab === "proxy" ||
      initialTab === "activity"
      ? initialTab
      : "overview",
  );
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateMachineId, setRotateMachineId] = useState<string | null>(null);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const activeServers = useMemo(
    () => servers.filter((s) => !s.retiredAt),
    [servers],
  );

  const selectedServer = activeServers.find((s) => s.id === initialServerId);
  const rotateTarget =
    machines.find((m) => m.id === rotateMachineId) ||
    (selected?.id === rotateMachineId ? selected : null);

  useEffect(() => {
    if (!rowMenu) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setRowMenu(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [rowMenu]);

  useEffect(() => {
    if (!copyToast) return;
    const t = window.setTimeout(() => setCopyToast(null), 1600);
    return () => window.clearTimeout(t);
  }, [copyToast]);

  function setQuery(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    if (!("page" in patch)) sp.delete("page");
    router.push(`/machines?${sp.toString()}`);
  }

  function openMachine(id: string, nextTab?: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("id", id);
    if (nextTab) sp.set("tab", nextTab);
    else sp.delete("tab");
    router.push(`/machines?${sp.toString()}`);
    if (nextTab === "setup" || nextTab === "proxy" || nextTab === "activity") {
      setTab(nextTab);
    } else if (!nextTab) {
      setTab("overview");
    }
  }

  function setupProgress(m: MachineRow) {
    const items = m.setupChecklist?.items ?? [];
    if (!items.length) return null;
    const done = items.filter(
      (i) =>
        i.status === "COMPLETED" ||
        (i.status === "NOT_APPLICABLE" && Boolean(i.naReason?.trim())),
    ).length;
    return { done, total: items.length, finished: Boolean(m.setupChecklist?.completedAt) };
  }

  function hasOpenSetup(m: MachineRow) {
    return Boolean(m.setupChecklist && !m.setupChecklist.completedAt);
  }

  function closeDrawer() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("id");
    router.push(`/machines?${sp.toString()}`);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast(`${label} copied`);
    } catch {
      setCopyToast("Copy failed");
    }
  }

  function rotateDisabledReason(m: MachineRow) {
    if (m.lifecycleStatus === "ARCHIVED" || m.archivedAt) {
      return "Archived machines cannot rotate proxy";
    }
    if (m.lifecycleStatus === "BURNED") {
      return "Burned machines cannot rotate proxy — continue wipeout instead";
    }
    return null;
  }

  function hasOpenWipeout(m: MachineRow) {
    return Boolean(m.closure && !m.closure.completedAt);
  }

  function canStartWipeout(m: MachineRow) {
    if (m.archivedAt || m.lifecycleStatus === "ARCHIVED") return false;
    if (hasOpenWipeout(m)) return false;
    return (
      m.lifecycleStatus === "ACTIVE" ||
      m.lifecycleStatus === "PREPARING" ||
      m.lifecycleStatus === "BURNED"
    );
  }

  function wipeoutDisabledReason(m: MachineRow) {
    if (m.archivedAt || m.lifecycleStatus === "ARCHIVED") {
      return "Archived machines have no open wipeout";
    }
    if (hasOpenWipeout(m)) return null;
    return null;
  }

  function openRotateFor(m: MachineRow) {
    setRowMenu(null);
    const reason = rotateDisabledReason(m);
    if (reason) {
      setError(reason);
      return;
    }
    setError(null);
    setRotateMachineId(m.id);
    setRotateOpen(true);
  }

  function startOrContinueWipeout(m: MachineRow) {
    setRowMenu(null);
    if (hasOpenWipeout(m)) {
      router.push(`/wipeout?id=${m.id}`);
      return;
    }
    if (!canStartWipeout(m)) {
      setError(wipeoutDisabledReason(m) || "Cannot start wipeout for this VM");
      return;
    }
    startTransition(async () => {
      const res = await markBurnedAction(m.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/wipeout?id=${m.id}`);
      router.refresh();
    });
  }

  function continueOrStartSetup(m: MachineRow) {
    setRowMenu(null);
    if (hasOpenSetup(m)) {
      openMachine(m.id, "setup");
      return;
    }
    if (m.lifecycleStatus !== "PREPARING" || m.setupChecklist) {
      setError("Setup can only be started for Preparing VMs without a checklist");
      return;
    }
    startTransition(async () => {
      const res = await startSetupAction(m.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      openMachine(m.id, "setup");
      router.refresh();
    });
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
            aria-label="Search machines"
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
          {LIFECYCLE_UI_STATUSES.filter((k) => k !== "ARCHIVED").map((k) => (
            <option key={k} value={k}>
              {LIFECYCLE_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>

      {copyToast ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-40 rounded-slate border border-line bg-surface px-3 py-2 text-sm text-ink shadow-soft"
        >
          {copyToast}
        </div>
      ) : null}

      {error && !selected && !addOpen && !rotateOpen ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-3 font-medium">VM</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Country</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">
                Internal IP
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">
                Proxy IP
              </th>
              <th className="px-4 py-3 font-medium">Renewal</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-14 text-center text-muted"
                >
                  No machines match these filters.
                </td>
              </tr>
            ) : (
              machines.map((m) => {
                const current = m.proxyAssignments[0]?.proxy;
                const overdue = isRenewalOverdue(current?.renewalDate ?? null);
                const rotateBlocked = rotateDisabledReason(m);
                const wipeoutContinue = hasOpenWipeout(m);
                const setup = setupProgress(m);
                const setupContinue = hasOpenSetup(m);
                return (
                  <tr
                    key={m.id}
                    className="border-b border-line last:border-0 hover:bg-sidebar/50"
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
                    <td className="px-4 py-3.5 text-ink">
                      {m.company?.trim() || ""}
                    </td>
                    <td className="px-4 py-3.5">
                      <CountryFlag code={m.country} />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill
                          label={LIFECYCLE_LABELS[m.lifecycleStatus]}
                          dotClass={LIFECYCLE_DOT[m.lifecycleStatus]}
                          pillClass={LIFECYCLE_PILL[m.lifecycleStatus]}
                        />
                        {setup && !setup.finished ? (
                          <span className="text-[11px] tabular-nums text-muted">
                            {setup.done}/{setup.total}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {m.internalIp ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] text-ink hover:underline"
                          aria-label={`Copy internal IP ${m.internalIp}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(m.internalIp!, "Internal IP");
                          }}
                        >
                          {m.internalIp}
                          <Copy className="h-3 w-3 text-muted" />
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {current ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] text-ink hover:underline"
                          aria-label={`Copy proxy IP ${current.ip}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(current.ip, "Proxy IP");
                          }}
                        >
                          {current.ip}
                          <Copy className="h-3 w-3 text-muted" />
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
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
                      <div
                        className="inline-flex items-center gap-1.5"
                        ref={rowMenu === m.id ? menuRef : undefined}
                      >
                        <div className="relative">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 whitespace-nowrap px-2.5"
                            aria-haspopup="menu"
                            aria-expanded={rowMenu === m.id}
                            aria-label={`Actions for VM ${m.vmid}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRowMenu(rowMenu === m.id ? null : m.id);
                            }}
                          >
                            Actions
                            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                          </Button>
                          {rowMenu === m.id ? (
                            <div
                              role="menu"
                              className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-slate border border-line bg-surface text-left shadow-soft"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                disabled={Boolean(rotateBlocked)}
                                title={rotateBlocked || undefined}
                                className="block w-full px-3 py-2 text-sm hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => openRotateFor(m)}
                              >
                                Rotate IP
                              </button>
                              {setupContinue ||
                              (m.lifecycleStatus === "PREPARING" &&
                                !m.setupChecklist) ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2 text-sm hover:bg-sidebar"
                                  onClick={() => continueOrStartSetup(m)}
                                >
                                  {setupContinue
                                    ? "Continue setup"
                                    : "Start setup checklist"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                disabled={
                                  !wipeoutContinue && !canStartWipeout(m)
                                }
                                title={
                                  wipeoutDisabledReason(m) || undefined
                                }
                                className="block w-full px-3 py-2 text-sm hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => startOrContinueWipeout(m)}
                              >
                                {wipeoutContinue
                                  ? "Continue wipeout"
                                  : "Start wipeout"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 whitespace-nowrap px-2.5"
                          aria-label={`View VM ${m.vmid}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRowMenu(null);
                            openMachine(m.id);
                          }}
                        >
                          View
                        </Button>
                      </div>
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
              const status = String(fd.get("lifecycleStatus") || "");
              if (!status) {
                setError("Status is required");
                return;
              }
              const res = await createMachineAction({
                vmid: Number(fd.get("vmid")),
                displayName: String(fd.get("displayName") || "") || undefined,
                serverId: String(fd.get("serverId")),
                company: String(fd.get("company") || "") || null,
                lifecycleStatus: status as LifecycleStatus,
                internalIp: String(fd.get("internalIp") || "") || undefined,
                country: String(fd.get("country") || "") || null,
                notes: String(fd.get("notes") || "") || undefined,
                proxyId: String(fd.get("proxyId") || "") || null,
              });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setAddOpen(false);
              router.refresh();
              if (res.id) {
                const status = String(fd.get("lifecycleStatus") || "");
                openMachine(
                  res.id,
                  status === "PREPARING" ? "setup" : "overview",
                );
              }
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
            <Select name="serverId" required defaultValue="">
              <option value="" />
              {activeServers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Company">
            <Input name="company" />
          </Field>
          <Field label="Status">
            <Select name="lifecycleStatus" required defaultValue="">
              <option value="" />
              {LIFECYCLE_CREATE_STATUSES.map((k) => (
                <option key={k} value={k}>
                  {LIFECYCLE_LABELS[k]}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted">
              Preparing opens a setup checklist. Active and Burned skip setup.
            </p>
          </Field>
          <Field label="Country">
            <CountrySelect name="country" defaultValue="" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Internal IP">
              <Input name="internalIp" />
            </Field>
            <Field label="Proxy">
              <Select name="proxyId" defaultValue="">
                <option value="" />
                {availableProxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ip} · {p.provider}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Textarea name="notes" rows={2} />
          </Field>
          {error && addOpen ? (
            <p className="text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Dialog>

      <Dialog
        open={rotateOpen}
        onClose={() => {
          setRotateOpen(false);
          setRotateMachineId(null);
        }}
        title="Rotate proxy"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRotateOpen(false);
                setRotateMachineId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              form="rotate-form"
              type="submit"
              disabled={pending || !rotateTarget}
            >
              Confirm rotate
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          Records a proxy replacement in the database only. Does not change
          GOST, SSH, or provider billing.
        </p>
        {rotateTarget ? (
          <form
            id="rotate-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(async () => {
                const res = await rotateProxyAction(rotateTarget.id, {
                  proxyId: String(fd.get("proxyId")),
                  reason: String(fd.get("reason")),
                });
                if (!res.ok) setError(res.error);
                else {
                  setRotateOpen(false);
                  setRotateMachineId(null);
                  setError(null);
                  router.refresh();
                }
              });
            }}
          >
            <Field label="VM">
              <Input
                disabled
                value={`VM ${rotateTarget.vmid}${rotateTarget.displayName ? ` · ${rotateTarget.displayName}` : ""}`}
              />
            </Field>
            <Field label="Current">
              <Input
                disabled
                value={
                  rotateTarget.proxyAssignments.find((a) => !a.endedAt)?.proxy
                    .ip || "None"
                }
              />
            </Field>
            <Field label="New proxy">
              <Select name="proxyId" required defaultValue="">
                <option value="" />
                {availableProxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ip} · {p.provider}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason">
              <Input name="reason" required />
            </Field>
            {error && rotateOpen ? (
              <p className="text-sm text-rose-700" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
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
                  ["setup", "Setup"],
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
                  onClick={() => {
                    setTab(id);
                    const sp = new URLSearchParams(searchParams.toString());
                    if (id === "overview") sp.delete("tab");
                    else sp.set("tab", id);
                    router.replace(`/machines?${sp.toString()}`);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" ? (
              <Overview
                machine={selected}
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
                      router.push(`/wipeout?id=${selected.id}`);
                      router.refresh();
                    }
                  });
                }}
                onRotate={() => {
                  setRotateMachineId(selected.id);
                  setRotateOpen(true);
                }}
                onMigrate={() => setMigrateOpen(true)}
                onContinueWipeout={() =>
                  router.push(`/wipeout?id=${selected.id}`)
                }
                onOpenSetup={() => setTab("setup")}
                onStartSetup={() => {
                  startTransition(async () => {
                    const res = await startSetupAction(selected.id);
                    if (!res.ok) setError(res.error);
                    else {
                      setTab("setup");
                      router.refresh();
                    }
                  });
                }}
                error={error}
              />
            ) : null}

            {tab === "setup" ? (
              selected.setupChecklist ? (
                <SetupChecklistPanel
                  machineId={selected.id}
                  checklist={selected.setupChecklist}
                  readOnly={Boolean(selected.setupChecklist.completedAt)}
                />
              ) : (
                <div className="space-y-3 text-sm">
                  <p className="text-muted">
                    {selected.lifecycleStatus === "ACTIVE"
                      ? "No setup checklist recorded."
                      : "No setup checklist for this VM."}
                  </p>
                  {selected.lifecycleStatus === "PREPARING" ? (
                    <Button
                      variant="primary"
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const res = await startSetupAction(selected.id);
                          if (!res.ok) setError(res.error);
                          else router.refresh();
                        });
                      }}
                    >
                      Start setup checklist
                    </Button>
                  ) : null}
                  {error ? (
                    <p className="text-sm text-rose-700" role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
              )
            ) : null}

            {tab === "proxy" ? (
              <ProxyHistory assignments={selected.proxyAssignments} />
            ) : null}

            {tab === "activity" ? (
              <ActivityList items={selected.activities} timezone={timezone} />
            ) : null}

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
                  <Select name="toServerId" required defaultValue="">
                    <option value="" />
                    {activeServers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Target VMID">
                  <Input name="toVmid" type="number" required min={1} />
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
  timezone,
  pending,
  onSave,
  onBurned,
  onRotate,
  onMigrate,
  onContinueWipeout,
  onOpenSetup,
  onStartSetup,
  error,
}: {
  machine: DetailMachine;
  timezone: string;
  pending: boolean;
  onSave: (input: {
    displayName?: string | null;
    company?: string | null;
    lifecycleStatus?: LifecycleStatus;
    internalIp?: string | null;
    country?: string | null;
    os?: string | null;
    notes?: string | null;
  }) => void;
  onBurned: () => void;
  onRotate: () => void;
  onMigrate: () => void;
  onContinueWipeout: () => void;
  onOpenSetup: () => void;
  onStartSetup: () => void;
  error: string | null;
}) {
  const current = machine.proxyAssignments.find((a) => !a.endedAt)?.proxy;
  const openWipeout = Boolean(machine.closure && !machine.closure.completedAt);
  const openSetup = Boolean(
    machine.setupChecklist && !machine.setupChecklist.completedAt,
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          displayName: String(fd.get("displayName") || "") || null,
          company: String(fd.get("company") || "") || null,
          lifecycleStatus: String(fd.get("lifecycleStatus")) as LifecycleStatus,
          internalIp: String(fd.get("internalIp") || "") || null,
          country: String(fd.get("country") || "") || null,
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
          <div className="font-mono text-xs">{current?.ip || ""}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Status</div>
          <StatusPill
            label={LIFECYCLE_LABELS[machine.lifecycleStatus]}
            dotClass={LIFECYCLE_DOT[machine.lifecycleStatus]}
            pillClass={LIFECYCLE_PILL[machine.lifecycleStatus]}
          />
        </div>
        <div className="col-span-2">
          <div className="text-xs text-muted">Country</div>
          <div>
            {machine.country
              ? `${countryName(machine.country) ?? machine.country}`
              : "—"}
          </div>
        </div>
      </div>
      {machine.setupChecklist ? (
        <div className="space-y-2">
          <SetupChecklistPanel
            machineId={machine.id}
            checklist={machine.setupChecklist}
            compact
          />
          {openSetup ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenSetup}>
              Continue setup
            </Button>
          ) : null}
        </div>
      ) : machine.lifecycleStatus === "PREPARING" ? (
        <div className="rounded-slate border border-line p-3 text-sm">
          <p className="text-muted">No setup checklist yet.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={pending}
            onClick={onStartSetup}
          >
            Start setup checklist
          </Button>
        </div>
      ) : machine.lifecycleStatus === "ACTIVE" ? (
        <p className="text-xs text-muted">No setup checklist recorded.</p>
      ) : null}
      <Field label="Display name">
        <Input name="displayName" defaultValue={machine.displayName || ""} />
      </Field>
      <Field label="Company">
        <Input name="company" defaultValue={machine.company || ""} />
      </Field>
      <Field label="Lifecycle">
        <Select name="lifecycleStatus" defaultValue={machine.lifecycleStatus}>
          {LIFECYCLE_UI_STATUSES.filter((k) => k !== "ARCHIVED").map((k) => (
            <option key={k} value={k}>
              {LIFECYCLE_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Country">
        <CountrySelect name="country" defaultValue={machine.country || ""} />
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
        {openWipeout ? (
          <Button type="button" variant="outline" onClick={onContinueWipeout}>
            Continue wipeout
          </Button>
        ) : (
          <>
            <Button type="button" variant="danger" onClick={onBurned}>
              Mark burned
            </Button>
          </>
        )}
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
