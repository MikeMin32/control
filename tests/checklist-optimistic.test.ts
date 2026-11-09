import { describe, expect, it } from "vitest";
import { ChecklistItemStatus } from "@prisma/client";
import {
  mergeChecklistOptimistic,
  shouldRetainOptimisticAfterSuccess,
  type ChecklistOptimisticPatch,
} from "../src/lib/checklist-optimistic";

type Item = {
  id: string;
  status: ChecklistItemStatus;
  naReason: string | null;
  required: boolean;
  label: string;
};

function item(
  id: string,
  status: ChecklistItemStatus,
  extras?: Partial<Item>,
): Item {
  return {
    id,
    status,
    naReason: null,
    required: true,
    label: id,
    ...extras,
  };
}

function countResolved(items: Item[]) {
  return items.filter((i) => {
    if (i.status === ChecklistItemStatus.COMPLETED) return true;
    if (
      i.status === ChecklistItemStatus.NOT_APPLICABLE &&
      Boolean(i.naReason?.trim())
    ) {
      return true;
    }
    return false;
  }).length;
}

describe("checklist optimistic progress (flicker regression)", () => {
  it("retains optimistic patch after success until server catches up", () => {
    const server = [
      item("a", ChecklistItemStatus.COMPLETED),
      item("b", ChecklistItemStatus.PENDING),
      item("c", ChecklistItemStatus.PENDING),
    ];
    expect(countResolved(server)).toBe(1);

    // User checks b → optimistic COMPLETED
    const patches: Record<string, ChecklistOptimisticPatch> = {
      b: { status: ChecklistItemStatus.COMPLETED },
    };
    const afterOptimistic = mergeChecklistOptimistic(server, patches);
    expect(countResolved(afterOptimistic)).toBe(2);

    // Bug: clearing patch on success before refresh → falls back to stale server
    const clearedTooEarly = mergeChecklistOptimistic(server, {});
    expect(countResolved(clearedTooEarly)).toBe(1); // would jump backward

    expect(
      shouldRetainOptimisticAfterSuccess(
        ChecklistItemStatus.PENDING,
        ChecklistItemStatus.COMPLETED,
      ),
    ).toBe(true);

    // Correct: keep patch until server props match
    const stillOptimistic = mergeChecklistOptimistic(server, patches);
    expect(countResolved(stillOptimistic)).toBe(2);

    // After refresh, server matches → patch can drop with no jump
    const refreshed = [
      item("a", ChecklistItemStatus.COMPLETED),
      item("b", ChecklistItemStatus.COMPLETED),
      item("c", ChecklistItemStatus.PENDING),
    ];
    const afterRefresh = mergeChecklistOptimistic(refreshed, {});
    expect(countResolved(afterRefresh)).toBe(2);
    expect(
      shouldRetainOptimisticAfterSuccess(
        ChecklistItemStatus.COMPLETED,
        ChecklistItemStatus.COMPLETED,
      ),
    ).toBe(false);
  });

  it("uncheck moves progress down without requiring clear-before-refresh", () => {
    const server = [
      item("a", ChecklistItemStatus.COMPLETED),
      item("b", ChecklistItemStatus.COMPLETED),
    ];
    const patches: Record<string, ChecklistOptimisticPatch> = {
      b: { status: ChecklistItemStatus.PENDING },
    };
    expect(countResolved(mergeChecklistOptimistic(server, patches))).toBe(1);
    // Stale clear would briefly show 2 again before refresh — retain instead
    expect(
      shouldRetainOptimisticAfterSuccess(
        ChecklistItemStatus.COMPLETED,
        ChecklistItemStatus.PENDING,
      ),
    ).toBe(true);
  });

  it("N/A with reason counts as resolved in the merge", () => {
    const server = [item("a", ChecklistItemStatus.PENDING)];
    const patches: Record<string, ChecklistOptimisticPatch> = {
      a: {
        status: ChecklistItemStatus.NOT_APPLICABLE,
        naReason: "not used",
      },
    };
    const merged = mergeChecklistOptimistic(server, patches);
    expect(countResolved(merged)).toBe(1);
    // Status-only optimistic N/A without reason must NOT count
    const noReason = mergeChecklistOptimistic(server, {
      a: { status: ChecklistItemStatus.NOT_APPLICABLE, naReason: null },
    });
    expect(countResolved(noReason)).toBe(0);
  });

  it("failed save reverts one item without discarding sibling optimistic successes", () => {
    const server = [
      item("a", ChecklistItemStatus.PENDING),
      item("b", ChecklistItemStatus.PENDING),
    ];
    // a succeeded optimistically; b fails and is reverted
    const afterFail: Record<string, ChecklistOptimisticPatch> = {
      a: { status: ChecklistItemStatus.COMPLETED },
      // b patch removed on revert
    };
    const merged = mergeChecklistOptimistic(server, afterFail);
    expect(merged.find((i) => i.id === "a")?.status).toBe(
      ChecklistItemStatus.COMPLETED,
    );
    expect(merged.find((i) => i.id === "b")?.status).toBe(
      ChecklistItemStatus.PENDING,
    );
    expect(countResolved(merged)).toBe(1);
  });
});
