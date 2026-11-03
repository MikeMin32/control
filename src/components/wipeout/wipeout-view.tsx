"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  ClosureChecklist,
  ClosureChecklistItem,
  Company,
  Machine,
  Server,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select } from "@/components/ui/input";
import {
  addCustomChecklistItemAction,
  completeClosureAction,
  updateChecklistItemAction,
} from "@/lib/actions";
import { CLOSURE_REASON_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

type Row = Machine & {
  server: Server;
  company: Company;
  closure: (ClosureChecklist & { items: ClosureChecklistItem[] }) | null;
};

export function WipeoutView({
  rows,
  timezone,
  selected,
}: {
  rows: Row[];
  timezone: string;
  selected: Row | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [naReasons, setNaReasons] = useState<Record<string, string>>({});

  function openRow(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("id", id);
    router.push(`/wipeout?${sp.toString()}`);
  }

  function closeDrawer() {
    router.push("/wipeout");
  }

  function progress(items: ClosureChecklistItem[]) {
    const required = items.filter((i) => i.required);
    const done = required.filter((i) => i.status !== "PENDING").length;
    return `${done}/${required.length}`;
  }

  function canComplete(items: ClosureChecklistItem[]) {
    return items
      .filter((i) => i.required)
      .every(
        (i) =>
          i.status === "COMPLETED" ||
          (i.status === "NOT_APPLICABLE" && Boolean(i.naReason?.trim())),
      );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Wipeout</h1>
        <p className="mt-1 text-sm text-muted">
          Manual closure checklists. Completing an item records attestation —
          it does not delete external resources.
        </p>
      </div>

      <div className="overflow-x-auto rounded-slate border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-sidebar/50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">VM</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Progress</th>
              <th className="px-4 py-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted">
                  No open wipeouts.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-sidebar/40"
                  onClick={() => openRow(r.id)}
                >
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {r.vmid}
                    {r.displayName ? (
                      <div className="text-xs font-normal text-muted">
                        {r.displayName}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{r.company.name}</td>
                  <td className="px-4 py-3">{r.server.name}</td>
                  <td className="px-4 py-3">
                    {r.closure
                      ? CLOSURE_REASON_LABELS[r.closure.reason]
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.closure ? progress(r.closure.items) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.closure
                      ? formatDate(r.closure.startedAt, timezone)
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={Boolean(selected?.closure)}
        onClose={closeDrawer}
        title={
          selected
            ? `Wipeout · VM ${selected.vmid}`
            : "Wipeout"
        }
        wide
      >
        {selected?.closure ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Template snapshot: {selected.closure.templateName}. Later template
              edits do not change this checklist.
            </p>
            <ul className="space-y-3">
              {selected.closure.items
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((item) => (
                  <li
                    key={item.id}
                    className="rounded-slate border border-line p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {item.required ? "Required" : "Optional"}
                        </div>
                      </div>
                      <Select
                        className="w-40"
                        value={item.status}
                        disabled={pending}
                        onChange={(e) => {
                          const status = e.target.value as
                            | "PENDING"
                            | "COMPLETED"
                            | "NOT_APPLICABLE";
                          if (status === "NOT_APPLICABLE") {
                            const reason = naReasons[item.id]?.trim();
                            if (!reason) {
                              setError(
                                "Enter an N/A explanation before selecting Not applicable",
                              );
                              return;
                            }
                            startTransition(async () => {
                              const res = await updateChecklistItemAction(
                                item.id,
                                { status, naReason: reason },
                              );
                              if (!res.ok) setError(res.error);
                              else {
                                setError(null);
                                router.refresh();
                              }
                            });
                            return;
                          }
                          startTransition(async () => {
                            const res = await updateChecklistItemAction(
                              item.id,
                              { status },
                            );
                            if (!res.ok) setError(res.error);
                            else {
                              setError(null);
                              router.refresh();
                            }
                          });
                        }}
                      >
                        <option value="PENDING">Pending</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="NOT_APPLICABLE">Not applicable</option>
                      </Select>
                    </div>
                    <Field label="N/A explanation" className="mt-2">
                      <Input
                        value={naReasons[item.id] ?? item.naReason ?? ""}
                        onChange={(e) =>
                          setNaReasons((s) => ({
                            ...s,
                            [item.id]: e.target.value,
                          }))
                        }
                        placeholder="Required when marking N/A"
                      />
                    </Field>
                    {item.notes ? (
                      <p className="mt-2 text-xs text-muted">{item.notes}</p>
                    ) : null}
                  </li>
                ))}
            </ul>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  const res = await addCustomChecklistItemAction(
                    selected.closure!.id,
                    String(fd.get("label")),
                    fd.get("required") === "on",
                  );
                  if (!res.ok) setError(res.error);
                  else {
                    (e.target as HTMLFormElement).reset();
                    router.refresh();
                  }
                });
              }}
            >
              <Input name="label" placeholder="Custom item" className="flex-1" />
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" name="required" defaultChecked />
                Required
              </label>
              <Button type="submit" variant="outline" disabled={pending}>
                Add
              </Button>
            </form>

            {error ? (
              <p className="text-sm text-rose-700" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              variant="primary"
              disabled={pending || !canComplete(selected.closure.items)}
              onClick={() => {
                startTransition(async () => {
                  const res = await completeClosureAction(selected.id);
                  if (!res.ok) setError(res.error);
                  else {
                    router.push("/archive");
                    router.refresh();
                  }
                });
              }}
            >
              Complete closure
            </Button>
            {!canComplete(selected.closure.items) ? (
              <p className="text-xs text-muted">
                Complete or mark N/A (with reason) on every required item before
                finishing.
              </p>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
