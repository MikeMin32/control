"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  MoreHorizontal,
  StickyNote,
} from "lucide-react";
import type { SetupChecklist, SetupChecklistItem } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  finishSetupAction,
  updateSetupItemAction,
} from "@/lib/actions";
import { SETUP_SECTIONS } from "@/lib/checklist-defaults";
import { useChecklistOptimistic } from "@/lib/checklist-optimistic";
import { cn } from "@/lib/utils";

type Checklist = SetupChecklist & { items: SetupChecklistItem[] };

function isResolved(item: {
  status: SetupChecklistItem["status"];
  naReason: string | null;
}) {
  if (item.status === "COMPLETED") return true;
  if (item.status === "NOT_APPLICABLE" && Boolean(item.naReason?.trim())) {
    return true;
  }
  return false;
}

export function SetupChecklistPanel({
  machineId,
  checklist,
  readOnly,
  compact,
}: {
  machineId: string;
  checklist: Checklist;
  readOnly?: boolean;
  /** When true, only show progress strip (for Overview). */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [noteItem, setNoteItem] = useState<SetupChecklistItem | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [naItem, setNaItem] = useState<SetupChecklistItem | null>(null);
  const [naDraft, setNaDraft] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const sortedServerItems = useMemo(
    () =>
      checklist.items.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [checklist.items],
  );

  const { items, begin, revert, clearAll, hasPatch } =
    useChecklistOptimistic(sortedServerItems);

  const resolved = items.filter(isResolved).length;
  const unresolvedRequired = items.filter((i) => i.required && !isResolved(i));
  const remaining = unresolvedRequired.length;
  const ready = remaining === 0;
  const locked = Boolean(readOnly || checklist.completedAt);
  const completedWithOverride = Boolean(
    (checklist as SetupChecklist & { completedWithOverride?: boolean })
      .completedWithOverride,
  );

  function submitFinish(allowIncomplete: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await finishSetupAction(
        machineId,
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
      router.refresh();
    });
  }

  const firstUnfinishedSection = SETUP_SECTIONS.find((section) =>
    items.some((i) => i.section === section && !isResolved(i)),
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of SETUP_SECTIONS) {
      init[s] = s === (firstUnfinishedSection || SETUP_SECTIONS[0]);
    }
    return init;
  });

  useEffect(() => {
    clearAll();
  }, [checklist.id, checklist.completedAt, clearAll]);

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

  function applyStatus(
    item: SetupChecklistItem,
    status: SetupChecklistItem["status"],
    extra?: { notes?: string; naReason?: string },
  ) {
    const seq = begin(item.id, {
      status,
      naReason:
        status === "NOT_APPLICABLE"
          ? extra?.naReason ?? null
          : status === "PENDING" || status === "COMPLETED"
            ? null
            : undefined,
    });
    setError(null);
    startTransition(async () => {
      const res = await updateSetupItemAction(item.id, { status, ...extra });
      if (!res.ok) {
        revert(item.id, seq);
        setError(res.error);
        return;
      }
      // Keep optimistic patch until props confirm — clearing here caused flicker
      router.refresh();
    });
  }

  if (compact) {
    return (
      <div className="space-y-1.5 rounded-slate border border-line p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink">Setup progress</span>
          <span className="text-muted">
            {resolved} of {items.length}
            {checklist.completedAt
              ? completedWithOverride
                ? " · completed with unfinished tasks"
                : " · finished"
              : ""}
          </span>
        </div>
        <ProgressBar value={resolved} max={items.length || 1} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">
            {resolved} of {items.length} resolved
          </span>
          {checklist.completedAt ? (
            <span className="text-xs text-muted">
              {completedWithOverride
                ? "Completed with unfinished tasks"
                : "Finished"}
            </span>
          ) : null}
        </div>
        <ProgressBar value={resolved} max={items.length || 1} />
        <p className="text-xs text-muted">
          Track setup steps completed outside VM Control. Checking items does
          not run Proxmox or other infrastructure commands.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {SETUP_SECTIONS.map((section, sectionIdx) => {
          const sectionItems = items.filter((i) => i.section === section);
          if (sectionItems.length === 0) return null;
          const secResolved = sectionItems.filter(isResolved).length;
          const done = secResolved === sectionItems.length;
          const open = expanded[section];
          return (
            <div
              key={section}
              className="overflow-hidden rounded-slate border border-line"
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-sidebar/50"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((s) => ({ ...s, [section]: !s[section] }))
                }
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs font-semibold text-muted">
                  {sectionIdx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{section}</div>
                  <div className="text-xs text-muted">
                    {secResolved}/{sectionItems.length}
                    {done ? " · complete" : ""}
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open ? (
                <ul className="space-y-2 border-t border-line bg-canvas/40 p-2">
                  {sectionItems.map((item) => {
                    const completed = item.status === "COMPLETED";
                    const na = item.status === "NOT_APPLICABLE";
                    const saving = hasPatch(item.id);
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          "rounded-slate border border-line bg-surface p-3 transition-colors",
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
                            disabled={locked || na}
                            onClick={() => {
                              if (locked || na) return;
                              applyStatus(
                                item,
                                completed ? "PENDING" : "COMPLETED",
                              );
                            }}
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                              completed
                                ? "border-[#2f9e5f] bg-[#2f9e5f] text-white"
                                : "border-line-strong bg-surface",
                              (locked || na) && "cursor-not-allowed opacity-50",
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
                                    "text-sm font-medium",
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
                                <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted">
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
                              {!locked ? (
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
                                      className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-slate border border-line bg-surface shadow-soft"
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
                              <p className="mt-2 text-xs text-muted">
                                {item.notes}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {!locked ? (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted">
              {ready ? (
                <span className="font-medium text-mint-text">
                  Ready to finish
                </span>
              ) : (
                <span>
                  {remaining} required item{remaining === 1 ? "" : "s"} remaining
                </span>
              )}
            </div>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                if (ready) {
                  submitFinish(false);
                  return;
                }
                setOverrideNote("");
                setOverrideOpen(true);
              }}
            >
              Finish setup
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : error ? (
        <p className="mt-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

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
              onClick={() => submitFinish(true)}
            >
              Complete anyway
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            {remaining} required task{remaining === 1 ? "" : "s"} still open.
            Completing will mark this VM Active (if Preparing) and leave those
            items Pending — they will not be marked N/A.
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
            />
          </Field>
        </div>
      </Dialog>

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
                startTransition(async () => {
                  const res = await updateSetupItemAction(noteItem.id, {
                    status: noteItem.status,
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
        <p className="mb-2 text-xs text-muted">
          Non-sensitive labels only (e.g. account nickname). Never store full
          card numbers or secrets.
        </p>
        <Field label="Note">
          <Textarea
            rows={3}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
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
        <Field label="Explanation">
          <Textarea
            rows={3}
            value={naDraft}
            onChange={(e) => setNaDraft(e.target.value)}
            required
          />
        </Field>
      </Dialog>
    </div>
  );
}
