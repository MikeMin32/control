"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type {
  DolphinAccount,
  DolphinProxyAssignment,
  Proxy,
  ProxyAssignment,
  Machine,
  Server,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import {
  createProxyAction,
  retireProxyAction,
  rotateDolphinConnectionProxyAction,
  updateProxyBillingAction,
} from "@/lib/actions";
import {
  AVAILABILITY_DOT,
  AVAILABILITY_LABELS,
  AVAILABILITY_PILL,
  BILLING_LABELS,
} from "@/lib/labels";
import { cn, formatCalendarDateLong } from "@/lib/utils";

type ProxyTab = "vm" | "dolphin";

type Row = Proxy & {
  purchaseSourceDolphin: DolphinAccount | null;
  assignments: (ProxyAssignment & {
    machine: Machine & { server: Server };
  })[];
  dolphinAssignments: (DolphinProxyAssignment & {
    dolphin: DolphinAccount;
  })[];
};

export function ProxiesView({
  tab,
  proxies,
  pendingCancellations,
  dolphins,
}: {
  tab: ProxyTab;
  proxies: Row[];
  pendingCancellations: Proxy[];
  dolphins: DolphinAccount[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [assignRow, setAssignRow] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("ALL");

  const shown =
    filter === "ALL"
      ? proxies
      : proxies.filter((p) => p.availability === filter);

  function setTab(next: ProxyTab) {
    setFilter("ALL");
    setError(null);
    router.push(next === "vm" ? "/proxies" : "/proxies?tab=dolphin");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Proxies</h1>
          <p className="page-subtitle">
            {tab === "vm"
              ? "VM proxies rotate onto machines. Purchase-source Dolphin is required on create."
              : "Dolphin proxies assign as connection proxies (one current per account)."}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setError(null);
            setAddOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {tab === "vm" ? "Add VM proxy" : "Add Dolphin proxy"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line pb-0">
        {(
          [
            { id: "vm" as const, label: "VM" },
            { id: "dolphin" as const, label: "Dolphin" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition",
              tab === t.id
                ? "border-ink font-medium text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {pendingCancellations.length > 0 ? (
        <div className="rounded-xl border border-[#f0d0d0] bg-[#fce8e8] px-4 py-3 text-sm text-[#8a3030]">
          {pendingCancellations.length} proxy
          {pendingCancellations.length === 1 ? "" : "ies"} with unresolved
          cancellation work.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {["ALL", "AVAILABLE", "ASSIGNED", "RETIRED"].map((f) => (
          <button
            key={f}
            type="button"
            className={cn(
              "rounded-slate border px-3 py-2 text-sm transition",
              filter === f
                ? "border-transparent bg-sidebar-active font-medium text-ink"
                : "border-line bg-surface text-muted hover:bg-sidebar/80",
            )}
            onClick={() => setFilter(f)}
          >
            {f === "ALL"
              ? "All"
              : AVAILABILITY_LABELS[f as keyof typeof AVAILABILITY_LABELS]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-3 font-medium">IP</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Availability</th>
              <th className="px-4 py-3 font-medium">Billing</th>
              {tab === "vm" ? (
                <>
                  <th className="px-4 py-3 font-medium">Dolphin</th>
                  <th className="px-4 py-3 font-medium">Assigned to</th>
                </>
              ) : (
                <th className="px-4 py-3 font-medium">Connection Dolphin</th>
              )}
              <th className="px-4 py-3 font-medium">Renewal</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td
                  colSpan={tab === "vm" ? 8 : 7}
                  className="px-4 py-8 text-center text-sm text-muted"
                >
                  No {tab === "vm" ? "VM" : "Dolphin"} proxies yet.
                </td>
              </tr>
            ) : (
              shown.map((p) => {
                const machineAssign = p.assignments[0];
                const dolphinAssign = p.dolphinAssignments[0];
                return (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{p.ip}</td>
                    <td className="px-4 py-3">{p.provider}</td>
                    <td className="px-4 py-3.5">
                      <StatusPill
                        label={AVAILABILITY_LABELS[p.availability]}
                        dotClass={AVAILABILITY_DOT[p.availability]}
                        pillClass={AVAILABILITY_PILL[p.availability]}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        className="h-8 w-48"
                        value={p.billingStatus}
                        onChange={(e) => {
                          startTransition(async () => {
                            await updateProxyBillingAction(
                              p.id,
                              e.target.value as never,
                            );
                            router.refresh();
                          });
                        }}
                      >
                        {Object.entries(BILLING_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    </td>
                    {tab === "vm" ? (
                      <>
                        <td className="px-4 py-3">
                          {p.purchaseSourceDolphin ? (
                            <Link
                              href="/dolphin"
                              className="text-ink underline-offset-2 hover:underline"
                            >
                              {p.purchaseSourceDolphin.accountName}
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {machineAssign
                            ? machineAssign.machine.company?.trim()
                              ? `${machineAssign.machine.vmid} · ${machineAssign.machine.company.trim()}`
                              : String(machineAssign.machine.vmid)
                            : "—"}
                        </td>
                      </>
                    ) : (
                      <td className="px-4 py-3">
                        {dolphinAssign ? (
                          <Link
                            href="/dolphin"
                            className="text-ink underline-offset-2 hover:underline"
                          >
                            {dolphinAssign.dolphin.accountName}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3.5">
                      {formatCalendarDateLong(p.renewalDate)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        {tab === "dolphin" &&
                        p.availability !== "RETIRED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                              setError(null);
                              setAssignRow(p);
                            }}
                          >
                            {dolphinAssign ? "Rotate" : "Assign"}
                          </Button>
                        ) : null}
                        {p.availability !== "RETIRED" &&
                        p.availability !== "ASSIGNED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                              startTransition(async () => {
                                const res = await retireProxyAction(p.id);
                                if (!res.ok) setError(res.error);
                                else router.refresh();
                              });
                            }}
                          >
                            Retire
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={tab === "vm" ? "Add VM proxy" : "Add Dolphin proxy"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              form="add-proxy-form"
              type="submit"
              disabled={pending}
            >
              Create
            </Button>
          </>
        }
      >
        <form
          id="add-proxy-form"
          className="space-y-3"
          key={`add-${tab}`}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await createProxyAction({
                ip: String(fd.get("ip")),
                provider: String(fd.get("provider")),
                kind: tab === "vm" ? "VM" : "DOLPHIN",
                purchaseSourceDolphinId:
                  tab === "vm"
                    ? String(fd.get("purchaseSourceDolphinId") || "") || null
                    : null,
                endpointHostname:
                  String(fd.get("endpointHostname") || "") || undefined,
                endpointPort: fd.get("endpointPort")
                  ? Number(fd.get("endpointPort"))
                  : undefined,
                country: String(fd.get("country") || "") || undefined,
                city: String(fd.get("city") || "") || undefined,
                renewalDate: String(fd.get("renewalDate") || "") || null,
                monthlyCost: fd.get("monthlyCost")
                  ? Number(fd.get("monthlyCost"))
                  : null,
                notes: String(fd.get("notes") || "") || undefined,
              });
              if (!res.ok) setError(res.error);
              else {
                setAddOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="IP">
              <Input name="ip" required />
            </Field>
            <Field label="Provider">
              <Input name="provider" required />
            </Field>
          </div>
          {tab === "vm" ? (
            <Field label="Purchase-source Dolphin">
              <Select name="purchaseSourceDolphinId" required defaultValue="">
                <option value="" />
                {dolphins.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.accountName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Endpoint host">
              <Input name="endpointHostname" />
            </Field>
            <Field label="Port">
              <Input name="endpointPort" type="number" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country">
              <Input name="country" />
            </Field>
            <Field label="City">
              <Input name="city" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Renewal date">
              <Input name="renewalDate" type="date" />
            </Field>
            <Field label="Monthly cost">
              <Input name="monthlyCost" type="number" step="0.01" />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea name="notes" rows={2} />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(assignRow)}
        onClose={() => setAssignRow(null)}
        title={
          assignRow?.dolphinAssignments[0]
            ? "Rotate connection proxy"
            : "Assign connection proxy"
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignRow(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              form="assign-dolphin-proxy-form"
              type="submit"
              disabled={pending}
            >
              Save
            </Button>
          </>
        }
      >
        <form
          id="assign-dolphin-proxy-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!assignRow) return;
            const fd = new FormData(e.currentTarget);
            const dolphinId = String(fd.get("dolphinId") || "");
            const reason = String(fd.get("reason") || "");
            startTransition(async () => {
              const res = await rotateDolphinConnectionProxyAction(dolphinId, {
                proxyId: assignRow.id,
                reason,
              });
              if (!res.ok) setError(res.error);
              else {
                setAssignRow(null);
                router.refresh();
              }
            });
          }}
        >
          <p className="text-sm text-muted">
            Proxy <span className="font-mono text-ink">{assignRow?.ip}</span>
          </p>
          <Field label="Dolphin account">
            <Select
              name="dolphinId"
              required
              defaultValue={
                assignRow?.dolphinAssignments[0]?.dolphinId || ""
              }
              key={assignRow?.id || "assign"}
            >
              <option value="" />
              {dolphins.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.accountName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason">
            <Input name="reason" required />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
