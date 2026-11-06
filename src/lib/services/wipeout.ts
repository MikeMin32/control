import {
  ChecklistItemStatus,
  ChecklistTemplateKind,
  ClosureReason,
  LifecycleStatus,
  ProxyAvailability,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";
import {
  DEFAULT_WIPEOUT_ITEMS,
  LEGACY_WIPEOUT_EMAIL_LABEL,
  isRedDotWipeoutTask,
  isSimilarEmailWipeoutTask,
  normalizeChecklistLabel,
} from "../checklist-defaults";

/**
 * Ensure the default wipeout template exists and includes current canonical
 * tasks (email shutdown + RedDot) without duplicating on repeated runs.
 * Existing closure snapshots are never mutated here.
 */
export async function ensureDefaultTemplate() {
  let existing = await prisma.checklistTemplate.findFirst({
    where: {
      OR: [
        { kind: ChecklistTemplateKind.WIPEOUT, isDefault: true },
        { isDefault: true, kind: ChecklistTemplateKind.WIPEOUT },
        { name: "Default wipeout" },
      ],
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  if (!existing) {
    existing = await prisma.checklistTemplate.findFirst({
      where: { isDefault: true },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  if (!existing) {
    return prisma.checklistTemplate.create({
      data: {
        name: "Default wipeout",
        kind: ChecklistTemplateKind.WIPEOUT,
        isDefault: true,
        items: {
          create: DEFAULT_WIPEOUT_ITEMS.map((item, i) => ({
            label: item.label,
            description: item.description ?? null,
            required: item.required,
            sortOrder: i,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  // Normalize kind for legacy rows
  if (existing.kind !== ChecklistTemplateKind.WIPEOUT || !existing.isDefault) {
    existing = await prisma.checklistTemplate.update({
      where: { id: existing.id },
      data: { kind: ChecklistTemplateKind.WIPEOUT, isDefault: true },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  const byNorm = new Map(
    existing.items.map((i) => [normalizeChecklistLabel(i.label), i]),
  );

  // Replace legacy generic email task on the TEMPLATE only (not snapshots)
  const legacyEmail = existing.items.find(
    (i) =>
      normalizeChecklistLabel(i.label) ===
      normalizeChecklistLabel(LEGACY_WIPEOUT_EMAIL_LABEL),
  );
  const canonicalEmail = DEFAULT_WIPEOUT_ITEMS.find((i) =>
    isSimilarEmailWipeoutTask(i.label),
  )!;
  if (legacyEmail) {
    await prisma.checklistTemplateItem.update({
      where: { id: legacyEmail.id },
      data: {
        label: canonicalEmail.label,
        description: canonicalEmail.description ?? null,
      },
    });
    byNorm.delete(normalizeChecklistLabel(LEGACY_WIPEOUT_EMAIL_LABEL));
    byNorm.set(normalizeChecklistLabel(canonicalEmail.label), legacyEmail);
  }

  let maxOrder = existing.items.reduce((m, i) => Math.max(m, i.sortOrder), -1);
  for (const item of DEFAULT_WIPEOUT_ITEMS) {
    const key = normalizeChecklistLabel(item.label);
    if (byNorm.has(key)) {
      const row = byNorm.get(key)!;
      if (item.description && row.description !== item.description) {
        await prisma.checklistTemplateItem.update({
          where: { id: row.id },
          data: { description: item.description },
        });
      }
      continue;
    }
    // Skip adding canonical email if a similar email task already exists
    if (
      isSimilarEmailWipeoutTask(item.label) &&
      existing.items.some((i) => isSimilarEmailWipeoutTask(i.label))
    ) {
      continue;
    }
    if (
      isRedDotWipeoutTask(item.label) &&
      existing.items.some((i) => isRedDotWipeoutTask(i.label))
    ) {
      continue;
    }
    maxOrder += 1;
    await prisma.checklistTemplateItem.create({
      data: {
        templateId: existing.id,
        label: item.label,
        description: item.description ?? null,
        required: item.required,
        sortOrder: maxOrder,
      },
    });
  }

  return prisma.checklistTemplate.findUniqueOrThrow({
    where: { id: existing.id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
}

export type MissingWipeoutTask = {
  label: string;
  description: string | null;
  required: boolean;
  similarExistingLabel: string | null;
};

/** Preview template tasks not present on an open checklist (no mutation). */
export async function previewMissingWipeoutTasks(
  checklistId: string,
): Promise<MissingWipeoutTask[]> {
  const checklist = await prisma.closureChecklist.findUnique({
    where: { id: checklistId },
    include: { items: true },
  });
  if (!checklist) throw new AppError("Checklist not found", "NOT_FOUND", 404);
  if (checklist.completedAt) {
    throw new AppError(
      "Completed wipeouts cannot be modified",
      "CLOSURE_DONE",
      409,
    );
  }

  const template = await ensureDefaultTemplate();
  const missing: MissingWipeoutTask[] = [];

  for (const tItem of template.items) {
    const exact = checklist.items.some(
      (i) =>
        normalizeChecklistLabel(i.label) ===
        normalizeChecklistLabel(tItem.label),
    );
    if (exact) continue;

    let similar: string | null = null;
    if (isSimilarEmailWipeoutTask(tItem.label)) {
      const hit = checklist.items.find((i) => isSimilarEmailWipeoutTask(i.label));
      if (hit) similar = hit.label;
    }
    if (isRedDotWipeoutTask(tItem.label)) {
      const hit = checklist.items.find((i) => isRedDotWipeoutTask(i.label));
      if (hit) similar = hit.label;
    }

    missing.push({
      label: tItem.label,
      description: tItem.description,
      required: tItem.required,
      similarExistingLabel: similar,
    });
  }

  return missing;
}

/**
 * Add selected missing template tasks to an open checklist.
 * For similar email tasks, omit from selection to keep the existing wording.
 */
export async function addMissingWipeoutTasks(
  checklistId: string,
  labels: string[],
  actorId: string,
) {
  const wanted = new Set(labels.map((l) => normalizeChecklistLabel(l)));
  if (wanted.size === 0) {
    throw new AppError("Select at least one task to add");
  }

  return prisma.$transaction(async (tx) => {
    const checklist = await tx.closureChecklist.findUnique({
      where: { id: checklistId },
      include: { items: true },
    });
    if (!checklist) throw new AppError("Checklist not found", "NOT_FOUND", 404);
    if (checklist.completedAt) {
      throw new AppError(
        "Completed wipeouts cannot be modified",
        "CLOSURE_DONE",
        409,
      );
    }

    const template = await ensureDefaultTemplate();
    const maxOrder = checklist.items.reduce(
      (m, i) => Math.max(m, i.sortOrder),
      -1,
    );
    let nextOrder = maxOrder + 1;
    const created = [];

    for (const tItem of template.items) {
      const key = normalizeChecklistLabel(tItem.label);
      if (!wanted.has(key)) continue;
      const already = checklist.items.some(
        (i) => normalizeChecklistLabel(i.label) === key,
      );
      if (already) continue;
      const item = await tx.closureChecklistItem.create({
        data: {
          checklistId,
          label: tItem.label,
          description: tItem.description,
          required: tItem.required,
          sortOrder: nextOrder++,
          status: ChecklistItemStatus.PENDING,
        },
      });
      created.push(item);
    }

    if (created.length > 0) {
      await logActivity(tx, {
        machineId: checklist.machineId,
        actorId,
        type: "closure.tasks_added",
        message: `Added ${created.length} missing wipeout template task(s)`,
        metadata: { labels: created.map((c) => c.label) },
      });
    }

    return created;
  });
}

export async function startClosure(
  machineId: string,
  input: { reason: ClosureReason; reasonNote?: string },
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const machine = await tx.machine.findUnique({
      where: { id: machineId },
      include: { closure: true },
    });
    if (!machine) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (machine.archivedAt) {
      throw new AppError("Machine already archived", "ARCHIVED");
    }
    if (machine.closure) {
      throw new AppError("Closure already started", "CLOSURE_EXISTS", 409);
    }

    let template = await tx.checklistTemplate.findFirst({
      where: { kind: ChecklistTemplateKind.WIPEOUT, isDefault: true },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!template) {
      template = await tx.checklistTemplate.findFirst({
        where: { isDefault: true },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
    }
    if (!template || template.items.length === 0) {
      throw new AppError("No wipeout checklist template configured");
    }

    const nextStatus =
      input.reason === ClosureReason.BURNED
        ? LifecycleStatus.BURNED
        : input.reason === ClosureReason.EXPIRED
          ? LifecycleStatus.EXPIRED
          : machine.lifecycleStatus === LifecycleStatus.ACTIVE ||
              machine.lifecycleStatus === LifecycleStatus.PREPARING
            ? LifecycleStatus.BURNED
            : machine.lifecycleStatus;

    await tx.machine.update({
      where: { id: machineId },
      data: { lifecycleStatus: nextStatus },
    });

    // Snapshot template items — later template edits must not mutate this checklist
    const checklist = await tx.closureChecklist.create({
      data: {
        machineId,
        reason: input.reason,
        reasonNote: input.reasonNote?.trim() || null,
        templateName: template.name,
        actorId,
        items: {
          create: template.items.map((item) => ({
            label: item.label,
            description: item.description,
            required: item.required,
            sortOrder: item.sortOrder,
            status: ChecklistItemStatus.PENDING,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    await logActivity(tx, {
      machineId,
      actorId,
      type: "closure.started",
      message: `Started wipeout (${input.reason})`,
      metadata: { checklistId: checklist.id, templateName: template.name },
    });

    return checklist;
  });
}

export async function markBurnedAndStartClosure(
  machineId: string,
  actorId: string,
  reasonNote?: string,
) {
  return startClosure(
    machineId,
    { reason: ClosureReason.BURNED, reasonNote },
    actorId,
  );
}

export async function updateChecklistItem(
  itemId: string,
  input: {
    status: ChecklistItemStatus;
    notes?: string;
    naReason?: string;
  },
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.closureChecklistItem.findUnique({
      where: { id: itemId },
      include: { checklist: true },
    });
    if (!item) throw new AppError("Checklist item not found", "NOT_FOUND", 404);
    if (item.checklist.completedAt) {
      throw new AppError("Closure already completed", "CLOSURE_DONE");
    }

    if (input.status === ChecklistItemStatus.NOT_APPLICABLE) {
      const reason = input.naReason?.trim();
      if (!reason) {
        throw new AppError(
          "Not applicable requires an explanation",
          "NA_REASON_REQUIRED",
        );
      }
    }

    const updated = await tx.closureChecklistItem.update({
      where: { id: itemId },
      data: {
        status: input.status,
        notes:
          input.notes === undefined
            ? undefined
            : input.notes.trim() || null,
        naReason:
          input.status === ChecklistItemStatus.NOT_APPLICABLE
            ? input.naReason?.trim() || null
            : null,
        completedAt:
          input.status === ChecklistItemStatus.PENDING ? null : new Date(),
        completedById:
          input.status === ChecklistItemStatus.PENDING ? null : actorId,
      },
    });

    await logActivity(tx, {
      machineId: item.checklist.machineId,
      actorId,
      type: "closure.item_updated",
      message: `Checklist item → ${input.status}`,
      metadata: { itemId, status: input.status },
    });

    return updated;
  });
}

export async function addCustomChecklistItem(
  checklistId: string,
  label: string,
  required: boolean,
  actorId: string,
) {
  const text = label.trim();
  if (!text) throw new AppError("Label is required");

  return prisma.$transaction(async (tx) => {
    const checklist = await tx.closureChecklist.findUnique({
      where: { id: checklistId },
      include: { items: true },
    });
    if (!checklist) throw new AppError("Checklist not found", "NOT_FOUND", 404);
    if (checklist.completedAt) {
      throw new AppError("Closure already completed", "CLOSURE_DONE");
    }
    const maxOrder = checklist.items.reduce(
      (m, i) => Math.max(m, i.sortOrder),
      -1,
    );
    const item = await tx.closureChecklistItem.create({
      data: {
        checklistId,
        label: text,
        required,
        sortOrder: maxOrder + 1,
      },
    });
    await logActivity(tx, {
      machineId: checklist.machineId,
      actorId,
      type: "closure.item_added",
      message: `Added custom checklist item`,
      metadata: { itemId: item.id },
    });
    return item;
  });
}

function assertChecklistReady(
  items: { required: boolean; status: ChecklistItemStatus; naReason: string | null }[],
) {
  for (const item of items) {
    if (!item.required) {
      if (item.status === ChecklistItemStatus.PENDING) {
        // optional pending is OK
      }
      continue;
    }
    if (item.status === ChecklistItemStatus.PENDING) {
      throw new AppError(
        "All required checklist items must be completed or marked N/A",
        "CHECKLIST_INCOMPLETE",
        409,
      );
    }
    if (
      item.status === ChecklistItemStatus.NOT_APPLICABLE &&
      !item.naReason?.trim()
    ) {
      throw new AppError(
        "N/A items require an explanation",
        "NA_REASON_REQUIRED",
        409,
      );
    }
  }
}

/**
 * Final closure: archive VM, end remaining proxy assignment, preserve billing + history.
 */
export async function completeClosure(machineId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const machine = await tx.machine.findUnique({
      where: { id: machineId },
      include: {
        closure: { include: { items: true } },
        proxyAssignments: { where: { endedAt: null } },
      },
    });
    if (!machine) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (!machine.closure) {
      throw new AppError("No closure checklist for this machine", "NO_CLOSURE");
    }
    if (machine.closure.completedAt) {
      throw new AppError("Closure already completed", "CLOSURE_DONE", 409);
    }

    assertChecklistReady(machine.closure.items);

    const now = new Date();

    for (const a of machine.proxyAssignments) {
      await tx.proxyAssignment.update({
        where: { id: a.id },
        data: { endedAt: now, reason: "Closure completed" },
      });
      await tx.proxy.update({
        where: { id: a.proxyId },
        data: { availability: ProxyAvailability.AVAILABLE },
      });
      // Billing intentionally preserved unless explicitly changed elsewhere
    }

    await tx.closureChecklist.update({
      where: { id: machine.closure.id },
      data: { completedAt: now, completedById: actorId },
    });

    const updated = await tx.machine.update({
      where: { id: machineId },
      data: {
        lifecycleStatus: LifecycleStatus.ARCHIVED,
        archivedAt: now,
      },
    });

    await logActivity(tx, {
      machineId,
      actorId,
      type: "closure.completed",
      message: "Completed wipeout and archived VM",
    });

    return updated;
  });
}

export async function listWipeoutQueue() {
  return prisma.machine.findMany({
    where: {
      archivedAt: null,
      closure: { is: { completedAt: null } },
    },
    include: {
      server: true,
      company: true,
      closure: { include: { items: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listArchive(params?: { q?: string }) {
  const q = params?.q?.trim();
  return prisma.machine.findMany({
    where: {
      lifecycleStatus: LifecycleStatus.ARCHIVED,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { company: { name: { contains: q, mode: "insensitive" } } },
              ...(Number.isFinite(Number.parseInt(q, 10))
                ? [{ vmid: Number.parseInt(q, 10) }]
                : []),
            ],
          }
        : {}),
    },
    include: {
      server: true,
      company: true,
      closure: { include: { items: true, completedBy: true } },
      proxyAssignments: {
        include: { proxy: true },
        orderBy: { startedAt: "desc" },
      },
      migrations: {
        include: { fromServer: true, toServer: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { archivedAt: "desc" },
  });
}
