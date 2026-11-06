import {
  ChecklistItemStatus,
  ClosureReason,
  LifecycleStatus,
  ProxyAvailability,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";

const DEFAULT_ITEMS: { label: string; required: boolean }[] = [
  { label: "Proxy subscription cancelled or renewal disabled.", required: true },
  { label: "Proxy configuration removed.", required: true },
  { label: "Browser/application profiles removed.", required: true },
  {
    label: "Associated email accounts removed or detached as appropriate.",
    required: true,
  },
  { label: "VM deleted or prepared for reuse.", required: true },
  { label: "Relevant network rules and access removed.", required: true },
];

export async function ensureDefaultTemplate() {
  const existing = await prisma.checklistTemplate.findFirst({
    where: { isDefault: true },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (existing) return existing;

  return prisma.checklistTemplate.create({
    data: {
      name: "Default wipeout",
      isDefault: true,
      items: {
        create: DEFAULT_ITEMS.map((item, i) => ({
          label: item.label,
          required: item.required,
          sortOrder: i,
        })),
      },
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
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

    const template = await tx.checklistTemplate.findFirst({
      where: { isDefault: true },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
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
