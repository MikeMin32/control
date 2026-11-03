"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { Proxy, ProxyAssignment, Machine, Server, Company } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/status-dot";
import {
  createProxyAction,
  retireProxyAction,
  updateProxyBillingAction,
} from "@/lib/actions";
import { AVAILABILITY_LABELS, BILLING_LABELS } from "@/lib/labels";
import { formatCalendarDate } from "@/lib/utils";

type Row = Proxy & {
  assignments: (ProxyAssignment & {
    machine: Machine & { server: Server; company: Company };
  })[];
};

export function ProxiesView({
  proxies,
  pendingCancellations,
}: {
  proxies: Row[];
  pendingCancellations: Proxy[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("ALL");

  const shown =
    filter === "ALL"
      ? proxies
      : proxies.filter((p) => p.availability === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Proxies</h1>
          <p className="mt-1 text-sm text-muted">
            Inventory of proxy IPs. Rotate records history only — billing is
            independent.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add proxy
        </Button>
      </div>

      {pendingCancellations.length > 0 ? (
        <div className="rounded-slate border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          {pendingCancellations.length} proxy
          {pendingCancellations.length === 1 ? "" : "ies"} with unresolved
          cancellation work.
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-line">
        {["ALL", "AVAILABLE", "ASSIGNED", "RETIRED"].map((f) => (
          <button
            key={f}
            type="button"
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              filter === f
                ? "border-ink font-medium"
                : "border-transparent text-muted"
            }`}
            onClick={() => setFilter(f)}
          >
            {f === "ALL"
              ? "All"
              : AVAILABILITY_LABELS[f as keyof typeof AVAILABILITY_LABELS]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-slate border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-sidebar/50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">IP</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Availability</th>
              <th className="px-4 py-3 font-medium">Billing</th>
              <th className="px-4 py-3 font-medium">Assigned to</th>
              <th className="px-4 py-3 font-medium">Renewal</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const a = p.assignments[0];
              return (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{p.ip}</td>
                  <td className="px-4 py-3">{p.provider}</td>
                  <td className="px-4 py-3">
                    <StatusDot
                      colorClass={
                        p.availability === "AVAILABLE"
                          ? "bg-emerald-500"
                          : p.availability === "ASSIGNED"
                            ? "bg-sky-500"
                            : "bg-slate-400"
                      }
                      label={AVAILABILITY_LABELS[p.availability]}
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
                  <td className="px-4 py-3">
                    {a
                      ? `${a.machine.vmid} · ${a.machine.company.name}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {formatCalendarDate(p.renewalDate)}
                  </td>
                  <td className="px-4 py-3 text-right">
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
                  </td>
                </tr>
              );
            })}
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
        title="Add proxy"
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
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await createProxyAction({
                ip: String(fd.get("ip")),
                provider: String(fd.get("provider")),
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
              <Input name="ip" required placeholder="192.0.2.10" />
            </Field>
            <Field label="Provider">
              <Input name="provider" required />
            </Field>
          </div>
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
    </div>
  );
}
