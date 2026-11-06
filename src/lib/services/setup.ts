import {
  ChecklistItemStatus,
  ChecklistTemplateKind,
  LifecycleStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";
import {
  DEFAULT_SETUP_ITEMS,
  SETUP_SECTIONS,
  normalizeChecklistLabel,
  type SetupSection,
} from "../checklist-defaults";

export async function ensureDefaultSetupTemplate() {
  const existing = await prisma.checklistTemplate.findFirst({
    where: { kind: ChecklistTemplateKind.SETUP, isDefault: true },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (existing) {
    // Idempotent: ensure all default labels exist without wiping custom extras
    const have = new Set(
      existing.items.map((i) => normalizeChecklistLabel(i.label)),
    );
    const missing = DEFAULT_SETUP_ITEMS.filter(
      (item) => !have.has(normalizeChecklistLabel(item.label)),
    );
    if (missing.length === 0) return existing;
    const maxOrder = existing.items.reduce(
      (m, i) => Math.max(m, i.sortOrder),
      -1,
    );
    await prisma.checklistTemplateItem.createMany({
      data: missing.map((item, i) => ({
        templateId: existing.id,
        label: item.label,
        description: item.description ?? null,
        section: item.section!,
        required: item.required,
        sortOrder: maxOrder + 1 + i,
      })),
    });
    return prisma.checklistTemplate.findUniqueOrThrow({
      where: { id: existing.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  return prisma.checklistTemplate.create({
    data: {
      name: "VM setup checklist",
      kind: ChecklistTemplateKind.SETUP,
      isDefault: true,
      items: {
        create: DEFAULT_SETUP_ITEMS.map((item, i) => ({
          label: item.label,
          description: item.description ?? null,
          section: item.section!,
          required: item.required,
          sortOrder: i,
        })),
      },
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function startSetupChecklist(
  machineId: string,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const machine = await tx.machine.findUnique({
      where: { id: machineId },
      include: {
        setupChecklist: true,
        closure: true,
      },
    });
    if (!machine) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (machine.archivedAt || machine.lifecycleStatus === LifecycleStatus.ARCHIVED) {
      throw new AppError("Cannot start setup on archived machine", "ARCHIVED", 409);
    }
    if (machine.setupChecklist) {
      throw new AppError("Setup checklist already exists", "SETUP_EXISTS", 409);
    }
    if (
      machine.lifecycleStatus === LifecycleStatus.BURNED ||
      machine.lifecycleStatus === LifecycleStatus.EXPIRED
    ) {
      throw new AppError(
        "Cannot start setup while machine is burned or expired",
        "INVALID_STATUS",
        409,
      );
    }
    if (machine.closure && !machine.closure.completedAt) {
      throw new AppError(
        "Cannot start setup while a wipeout is open",
        "WIPEOUT_OPEN",
        409,
      );
    }

    const template = await tx.checklistTemplate.findFirst({
      where: { kind: ChecklistTemplateKind.SETUP, isDefault: true },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!template || template.items.length === 0) {
      throw new AppError("No setup checklist template configured");
    }

    const checklist = await tx.setupChecklist.create({
      data: {
        machineId,
        templateName: template.name,
        actorId,
        items: {
          create: template.items.map((item) => ({
            section: item.section || "VM",
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
      type: "setup.started",
      message: "Started VM setup checklist",
      metadata: { checklistId: checklist.id, templateName: template.name },
    });

    return checklist;
  });
}

export async function updateSetupItem(
  itemId: string,
  input: {
    status: ChecklistItemStatus;
    notes?: string;
    naReason?: string;
  },
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.setupChecklistItem.findUnique({
      where: { id: itemId },
      include: { checklist: true },
    });
    if (!item) throw new AppError("Setup item not found", "NOT_FOUND", 404);
    if (item.checklist.completedAt) {
      throw new AppError("Setup already finished", "SETUP_DONE", 409);
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

    const updated = await tx.setupChecklistItem.update({
      where: { id: itemId },
      data: {
        status: input.status,
        notes:
          input.notes === undefined ? undefined : input.notes.trim() || null,
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
      type: "setup.item_updated",
      message: `Setup item → ${input.status}`,
      metadata: { itemId, status: input.status },
    });

    return updated;
  });
}

function assertSetupReady(
  items: {
    required: boolean;
    status: ChecklistItemStatus;
    naReason: string | null;
  }[],
) {
  for (const item of items) {
    if (!item.required) continue;
    if (item.status === ChecklistItemStatus.PENDING) {
      throw new AppError(
        "All required setup items must be completed or marked N/A",
        "SETUP_INCOMPLETE",
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
 * Finish setup: mark checklist complete and Preparing → Active.
 * Does not start Proxmox or run infrastructure commands.
 */
export async function finishSetup(machineId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const machine = await tx.machine.findUnique({
      where: { id: machineId },
      include: {
        setupChecklist: { include: { items: true } },
        closure: true,
      },
    });
    if (!machine) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (!machine.setupChecklist) {
      throw new AppError("No setup checklist for this machine", "NO_SETUP");
    }
    if (machine.setupChecklist.completedAt) {
      throw new AppError("Setup already finished", "SETUP_DONE", 409);
    }
    if (
      machine.lifecycleStatus === LifecycleStatus.BURNED ||
      machine.lifecycleStatus === LifecycleStatus.EXPIRED ||
      machine.lifecycleStatus === LifecycleStatus.ARCHIVED ||
      machine.archivedAt
    ) {
      throw new AppError(
        "Cannot finish setup for burned, expired, or archived machines",
        "INVALID_STATUS",
        409,
      );
    }
    if (machine.closure && !machine.closure.completedAt) {
      throw new AppError(
        "Cannot finish setup while a wipeout is open",
        "WIPEOUT_OPEN",
        409,
      );
    }

    assertSetupReady(machine.setupChecklist.items);

    const now = new Date();
    await tx.setupChecklist.update({
      where: { id: machine.setupChecklist.id },
      data: { completedAt: now, completedById: actorId },
    });

    const updated = await tx.machine.update({
      where: { id: machineId },
      data: {
        lifecycleStatus:
          machine.lifecycleStatus === LifecycleStatus.PREPARING
            ? LifecycleStatus.ACTIVE
            : machine.lifecycleStatus,
      },
    });

    await logActivity(tx, {
      machineId,
      actorId,
      type: "setup.finished",
      message:
        machine.lifecycleStatus === LifecycleStatus.PREPARING
          ? "Finished setup; marked Active"
          : "Finished setup checklist",
    });

    return updated;
  });
}

export function sectionProgress(
  items: { section: string; status: ChecklistItemStatus; naReason: string | null; required: boolean }[],
  section: SetupSection,
) {
  const inSection = items.filter((i) => i.section === section);
  const resolved = inSection.filter(
    (i) =>
      i.status === ChecklistItemStatus.COMPLETED ||
      (i.status === ChecklistItemStatus.NOT_APPLICABLE &&
        Boolean(i.naReason?.trim())),
  ).length;
  return { total: inSection.length, resolved };
}

export { SETUP_SECTIONS };
