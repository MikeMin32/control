"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Info,
  MoreHorizontal,
  StickyNote,
} from "lucide-react";
import type {
  ClosureChecklist,
  ClosureChecklistItem,
  Company,
  Machine,
  Server,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  addCustomChecklistItemAction,
  addMissingWipeoutTasksAction,
  completeClosureAction,
  previewMissingWipeoutTasksAction,
  updateChecklistItemAction,
} from "@/lib/actions";
import { CLOSURE_REASON_LABELS } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { MissingWipeoutTask } from "@/lib/services/wipeout";

type Row = Machine & {
  server: Server;
  company: Company;
  closure: (ClosureChecklist & { items: ClosureChecklistItem[] }) | null;
};

function isResolved(item: ClosureChecklistItem) {
  if (item.status === "COMPLETED") return true;
  if (item.status === "NOT_APPLICABLE" && Boolean(item.naReason?.trim())) {
    return true;
  }
  return false;
}

function countResolved(items: ClosureChecklistItem[]) {
  return items.filter(isResolved).length;
}

function requiredRemaining(items: ClosureChecklistItem[]) {
  return items.filter((i) => i.required && !isResolved(i)).length;
}

function canComplete(items: ClosureChecklistItem[]) {
  return requiredRemaining(items) === 0;
}

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
  const [optimistic, setOptimistic] = useState<
    Record<string, ClosureChecklistItem["status"]>
  >({});
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [noteItem, setNoteItem] = useState<ClosureChecklistItem | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [naItem, setNaItem] = useState<ClosureChecklistItem | null>(null);
  const [naDraft, setNaDraft] = useState("");
  const [missingOpen, setMissingOpen] = useState(false);
  const [missing, setMissing] = useState<MissingWipeoutTask[]>([]);
  const [missingSelected, setMissingSelected] = useState<Record<string, boolean>>(
    {},
  );
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closure = selected?.closure ?? null;
  const items = useMemo(() => {
    if (!closure) return [];
    return closure.items
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) =>
        optimistic[item.id]
          ? { ...item, status: optimistic[item.id]! }
          : item,
      );
  }, [closure, optimistic]);

  const resolved = countResolved(items);
  const unresolvedRequired = items.filter((i) => i.required && !isResolved(i));
  const remaining = unresolvedRequired.length;
  const ready = canComplete(items);
  const readOnly = Boolean(closure?.completedAt);
  const completedWithOverride = Boolean(
    (closure as (ClosureChecklist & { completedWithOverride?: boolean }) | null)
      ?.completedWithOverride,
  );

  function submitComplete(allowIncomplete: boolean) {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await completeClosureAction(
        selected.id,
        allowIncomplete
          ? {
              allowIncomplete: true,
              overrideNote,
              expectedUnresolvedIds: unresolvedRequired.map((i) => i.id),
            }
          : {},
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOverrideOpen(false);
      setOverrideNote("");
      router.push("/archive");
      router.refresh();
    });
  }

  useEffect(() => {
    setOptimistic({});
  }, [closure?.id]);

  useEffect(() => {
    if (!menuItemId) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuItemId(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuItemId]);

  function openRow(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("id", id);
    router.push(`/wipeout?${sp.toString()}`);
  }

  function closeDrawer() {
    router.push("/wipeout");
  }

  function applyStatus(
    item: ClosureChecklistItem,
    status: ClosureChecklistItem["status"],
    extra?: { notes?: string; naReason?: string },
  ) {
    const previous = item.status;
    setOptimistic((s) => ({ ...s, [item.id]: status }));
    setError(null);
    startTransition(async () => {
      const res = await updateChecklistItemAction(item.id, {
        status,
        ...extra,
      });
      if (!res.ok) {
        setOptimistic((s) => ({ ...s, [item.id]: previous }));
        setError(res.error);
        return;
      }
      setOptimistic((s) => {
        const next = { ...s };
        delete next[item.id];
        return next;
      });
      router.refresh();
    });
  }

  function toggleComplete(item: ClosureChecklistItem) {
    if (readOnly || pending) return;
    if (item.status === "NOT_APPLICABLE") return;
    if (item.status === "COMPLETED") {
      applyStatus(item, "PENDING");
    } else {
      applyStatus(item, "COMPLETED");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Wipeout</h1>
        <p className="page-subtitle">
          Track cleanup steps completed outside VM Control.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head">
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
              rows.map((r) => {
                const list = r.closure?.items ?? [];
                const done = countResolved(list);
                const total = list.length;
                return (
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
                      {r.closure ? (
                        <div className="min-w-[140px] space-y-1.5">
                          <ProgressBar value={done} max={total || 1} />
                          <div className="text-xs text-muted">
                            {done} of {total} resolved
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.closure
                        ? formatDate(r.closure.startedAt, timezone)
                        : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={Boolean(selected?.closure)}
        onClose={closeDrawer}
        wide
        title={
          selected ? `Wipeout · VM ${selected.vmid}` : "Wipeout"
        }
        subtitle={
          selected
            ? [selected.displayName, selected.company.name]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        headerExtra={
          selected?.closure ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">
                  {resolved} of {items.length} resolved
                </span>
                <span
                  className="inline-flex items-center gap-1 text-xs text-muted"
                  title={`Template snapshot: ${selected.closure.templateName}. Later template edits do not change this checklist.`}
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Template details
                </span>
              </div>
              <ProgressBar value={resolved} max={items.length || 1} />
            </div>
          ) : null
        }
        footer={
          selected?.closure && !readOnly ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted">
                  {ready ? (
                    <span className="font-medium text-mint-text">
                      Ready to close
                    </span>
                  ) : (
                    <span>
                      {remaining} required item{remaining === 1 ? "" : "s"}{" "}
                      remaining
                    </span>
                  )}
                </div>
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() => {
                    if (ready) {
                      submitComplete(false);
                      return;
                    }
                    setOverrideNote("");
                    setOverrideOpen(true);
                  }}
                >
                  Complete closure
                </Button>
              </div>
              {error ? (
                <p className="text-sm text-rose-700" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : selected?.closure && readOnly ? (
            <p className="text-sm text-muted">
              {completedWithOverride
                ? "Completed with unfinished tasks — archived."
                : "This closure is complete."}
            </p>
          ) : null
        }
      >
        {selected?.closure ? (
          <div className="space-y-3 pb-2">
            <ul className="space-y-2">
              {items.map((item) => {
                const completed = item.status === "COMPLETED";
                const na = item.status === "NOT_APPLICABLE";
                const saving = pending && optimistic[item.id];
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-slate border border-line p-3 transition-colors duration-200 motion-reduce:transition-none",
                      completed && "border-[#cfead6] bg-[#f4faf6]",
                      na && "bg-sidebar/60",
                      saving && "opacity-70",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={completed}
                        aria-label={`Mark ${item.label} ${completed ? "pending" : "completed"}`}
                        disabled={readOnly || na}
                        onClick={() => toggleComplete(item)}
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition",
                          completed
                            ? "border-[#2f9e5f] bg-[#2f9e5f] text-white"
                            : "border-line-strong bg-surface",
                          (readOnly || na) && "cursor-not-allowed opacity-50",
                        )}
                      >
                        {completed ? (
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        ) : null}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div
                              className={cn(
                                "text-sm font-medium text-ink",
                                completed && "text-muted",
                              )}
                            >
                              {item.label}
                            </div>
                            {item.description ? (
                              <p className="mt-0.5 text-xs text-muted">
                                {item.description}
                              </p>
                            ) : null}
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                              {item.required ? (
                                <span>Required</span>
                              ) : (
                                <span>Optional</span>
                              )}
                              {na ? (
                                <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                  N/A
                                </span>
                              ) : null}
                              {item.notes ? (
                                <span className="inline-flex items-center gap-1">
                                  <StickyNote className="h-3 w-3" />
                                  Note
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {!readOnly ? (
                            <div
                              className="relative"
                              ref={
                                menuItemId === item.id ? menuRef : undefined
                              }
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`More options for ${item.label}`}
                                aria-haspopup="menu"
                                aria-expanded={menuItemId === item.id}
                                onClick={() =>
                                  setMenuItemId(
                                    menuItemId === item.id ? null : item.id,
                                  )
                                }
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                              {menuItemId === item.id ? (
                                <div
                                  role="menu"
                                  className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-slate border border-line bg-surface text-left shadow-soft"
                                >
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="block w-full px-3 py-2 text-sm hover:bg-sidebar"
                                    onClick={() => {
                                      setMenuItemId(null);
                                      setNoteItem(item);
                                      setNoteDraft(item.notes || "");
                                    }}
                                  >
                                    {item.notes ? "Edit note" : "Add note"}
                                  </button>
                                  {na ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="block w-full px-3 py-2 text-sm hover:bg-sidebar"
                                      onClick={() => {
                                        setMenuItemId(null);
                                        applyStatus(item, "PENDING");
                                      }}
                                    >
                                      Return to pending
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="block w-full px-3 py-2 text-sm hover:bg-sidebar"
                                      onClick={() => {
                                        setMenuItemId(null);
                                        setNaItem(item);
                                        setNaDraft(item.naReason || "");
                                      }}
                                    >
                                      Mark as not applicable
                                    </button>
                                  )}
                                  {completed ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="block w-full px-3 py-2 text-sm hover:bg-sidebar"
                                      onClick={() => {
                                        setMenuItemId(null);
                                        applyStatus(item, "PENDING");
                                      }}
                                    >
                                      Reopen
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {na && item.naReason ? (
                          <p className="mt-2 text-xs text-muted">
                            {item.naReason}
                          </p>
                        ) : null}
                        {item.notes ? (
                          <p className="mt-2 text-xs text-muted">{item.notes}</p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {!readOnly ? (
              <div className="space-y-3 border-t border-line pt-3">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const res = await previewMissingWipeoutTasksAction(
                        selected.closure!.id,
                      );
                      if (!res.ok) {
                        setError(res.error);
                        return;
                      }
                      const list = res.missing || [];
                      setMissing(list);
                      const sel: Record<string, boolean> = {};
                      for (const m of list) {
                        // Default: select new tasks; leave similar email unchecked (keep existing)
                        sel[m.label] = !m.similarExistingLabel;
                      }
                      setMissingSelected(sel);
                      setMissingOpen(true);
                    });
                  }}
                >
                  Add missing template tasks
                </Button>
                <form
                  className="flex flex-wrap gap-2"
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
                  <Input
                    name="label"
                    placeholder="Custom item"
                    className="min-w-[160px] flex-1"
                  />
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" name="required" defaultChecked />
                    Required
                  </label>
                  <Button type="submit" variant="outline" disabled={pending}>
                    Add
                  </Button>
                </form>
              </div>
            ) : null}

            {error && !naItem && !noteItem ? (
              <p className="text-sm text-rose-700" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Dialog
        open={Boolean(noteItem)}
        onClose={() => setNoteItem(null)}
        title={noteItem?.notes ? "Edit note" : "Add note"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteItem(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || !noteItem}
              onClick={() => {
                if (!noteItem) return;
                const status = noteItem.status;
                startTransition(async () => {
                  const res = await updateChecklistItemAction(noteItem.id, {
                    status,
                    notes: noteDraft,
                  });
                  if (!res.ok) setError(res.error);
                  else {
                    setNoteItem(null);
                    router.refresh();
                  }
                });
              }}
            >
              Save note
            </Button>
          </>
        }
      >
        <Field label="Note">
          <Textarea
            rows={3}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Optional context for this step"
          />
        </Field>
      </Dialog>

      <Dialog
        open={Boolean(naItem)}
        onClose={() => setNaItem(null)}
        title="Mark as not applicable"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaItem(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || !naItem || !naDraft.trim()}
              onClick={() => {
                if (!naItem || !naDraft.trim()) return;
                applyStatus(naItem, "NOT_APPLICABLE", {
                  naReason: naDraft.trim(),
                });
                setNaItem(null);
              }}
            >
              Save N/A
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          Provide a short explanation. N/A is distinct from completed.
        </p>
        <Field label="Explanation">
          <Textarea
            rows={3}
            value={naDraft}
            onChange={(e) => setNaDraft(e.target.value)}
            placeholder="Why this step does not apply"
            required
          />
        </Field>
      </Dialog>

      <Dialog
        open={missingOpen}
        onClose={() => setMissingOpen(false)}
        title="Add missing template tasks"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMissingOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                pending ||
                !Object.values(missingSelected).some(Boolean)
              }
              onClick={() => {
                const labels = missing
                  .filter((m) => missingSelected[m.label])
                  .map((m) => m.label);
                if (!selected?.closure || labels.length === 0) return;
                startTransition(async () => {
                  const res = await addMissingWipeoutTasksAction(
                    selected.closure!.id,
                    labels,
                  );
                  if (!res.ok) setError(res.error);
                  else {
                    setMissingOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              Add selected
            </Button>
          </>
        }
      >
        {missing.length === 0 ? (
          <p className="text-sm text-muted">
            This open checklist already includes every current template task.
          </p>
        ) : (
          <ul className="space-y-3">
            {missing.map((m) => (
              <li key={m.label} className="rounded-slate border border-line p-3">
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(missingSelected[m.label])}
                    onChange={(e) =>
                      setMissingSelected((s) => ({
                        ...s,
                        [m.label]: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="font-medium">{m.label}</span>
                    {m.description ? (
                      <span className="mt-0.5 block text-xs text-muted">
                        {m.description}
                      </span>
                    ) : null}
                    {m.similarExistingLabel ? (
                      <span className="mt-1 block text-xs text-muted">
                        Similar task already on checklist: “
                        {m.similarExistingLabel}”. Leave unchecked to keep it.
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Complete with unfinished tasks?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>
              Go back
            </Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => submitComplete(true)}
            >
              Complete anyway
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            {remaining} required task{remaining === 1 ? "" : "s"} still open.
            Completing will archive this VM and leave those items Pending —
            they will not be marked N/A.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ink">
            {unresolvedRequired.map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ul>
          <Field label="Note (optional)">
            <Textarea
              rows={2}
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              placeholder="Why completing early"
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
