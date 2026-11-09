import { ChecklistItemStatus } from "@prisma/client";

export type UnresolvedItem = { id: string; label: string };

export function listUnresolvedRequired(
  items: {
    id: string;
    label: string;
    required: boolean;
    status: ChecklistItemStatus;
    naReason: string | null;
  }[],
): UnresolvedItem[] {
  return items
    .filter((i) => i.required)
    .filter((i) => {
      if (i.status === ChecklistItemStatus.COMPLETED) return false;
      if (
        i.status === ChecklistItemStatus.NOT_APPLICABLE &&
        Boolean(i.naReason?.trim())
      ) {
        return false;
      }
      return true;
    })
    .map((i) => ({ id: i.id, label: i.label }));
}

export function sameUnresolvedSet(
  expected: string[] | undefined,
  actual: UnresolvedItem[],
): boolean {
  if (!expected) return false;
  const a = [...expected].sort();
  const b = actual.map((i) => i.id).sort();
  if (a.length !== b.length) return false;
  return a.every((id, idx) => id === b[idx]);
}

export type CompleteOverrideInput = {
  /** Explicit flag required when unresolved required items remain. */
  allowIncomplete?: boolean;
  overrideNote?: string;
  /** IDs client saw as unresolved — must match server at finalize. */
  expectedUnresolvedIds?: string[];
};
