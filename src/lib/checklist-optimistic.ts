import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChecklistItemStatus } from "@prisma/client";

export type ChecklistOptimisticPatch = {
  status: ChecklistItemStatus;
  naReason?: string | null;
};

type ItemBase = {
  id: string;
  status: ChecklistItemStatus;
  naReason: string | null;
};

/**
 * Optimistic checklist status that stays applied until server props catch up.
 *
 * Previous bug: clearing the optimistic entry on save success (before
 * router.refresh) made progress fall back to stale PENDING counts, then
 * jump forward again when props arrived — a visible progress-bar flicker.
 *
 * Per-item sequence numbers ignore out-of-order mutation responses.
 */
export function useChecklistOptimistic<T extends ItemBase>(serverItems: T[]) {
  const [patches, setPatches] = useState<
    Record<string, ChecklistOptimisticPatch>
  >({});
  const seqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setPatches((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const server = serverItems.find((i) => i.id === id);
        const patch = next[id]!;
        if (!server) {
          delete next[id];
          changed = true;
          continue;
        }
        if (server.status !== patch.status) continue;
        if (
          patch.status === "NOT_APPLICABLE" &&
          !server.naReason?.trim()
        ) {
          // Wait until server stores the N/A reason (resolved)
          continue;
        }
        delete next[id];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [serverItems]);

  const items = useMemo(() => {
    return serverItems.map((item) => {
      const patch = patches[item.id];
      if (!patch) return item;
      return {
        ...item,
        status: patch.status,
        naReason:
          patch.naReason !== undefined ? patch.naReason : item.naReason,
      };
    });
  }, [serverItems, patches]);

  const begin = useCallback(
    (itemId: string, patch: ChecklistOptimisticPatch): number => {
      const seq = (seqRef.current[itemId] ?? 0) + 1;
      seqRef.current[itemId] = seq;
      setPatches((s) => ({ ...s, [itemId]: patch }));
      return seq;
    },
    [],
  );

  const isCurrent = useCallback((itemId: string, seq: number) => {
    return seqRef.current[itemId] === seq;
  }, []);

  /**
   * Failed save for the current seq → drop patch so UI shows confirmed
   * server props. Stale failures (superseded by a newer mutation) are ignored.
   */
  const revert = useCallback((itemId: string, seq: number) => {
    if (seqRef.current[itemId] !== seq) return;
    setPatches((s) => {
      if (!(itemId in s)) return s;
      const next = { ...s };
      delete next[itemId];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    seqRef.current = {};
    setPatches({});
  }, []);

  const hasPatch = useCallback(
    (itemId: string) => patches[itemId] !== undefined,
    [patches],
  );

  return {
    items,
    patches,
    begin,
    isCurrent,
    revert,
    clearAll,
    hasPatch,
  };
}

/** Pure merge for unit tests. */
export function mergeChecklistOptimistic<T extends ItemBase>(
  serverItems: T[],
  patches: Record<string, ChecklistOptimisticPatch>,
): T[] {
  return serverItems.map((item) => {
    const patch = patches[item.id];
    if (!patch) return item;
    return {
      ...item,
      status: patch.status,
      naReason:
        patch.naReason !== undefined ? patch.naReason : item.naReason,
    };
  });
}

/**
 * After a successful mutation, retain the optimistic patch while server
 * props still show the previous status — clearing early causes flicker.
 */
export function shouldRetainOptimisticAfterSuccess(
  serverStatus: ChecklistItemStatus,
  optimisticStatus: ChecklistItemStatus,
): boolean {
  return serverStatus !== optimisticStatus;
}
