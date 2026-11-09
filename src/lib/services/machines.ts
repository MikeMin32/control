import {
  ChecklistItemStatus,
  ChecklistTemplateKind,
  LifecycleStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";
import { normalizeCountryCode } from "../countries";
import { ensureDefaultSetupTemplate } from "./setup";

export type MachineListParams = {
  serverId?: string | null;
  q?: string;
  status?: LifecycleStatus | "ALL";
  page?: number;
  pageSize?: number;
  sort?: "vmid" | "company" | "status" | "createdAt" | "proxy";
  order?: "asc" | "desc";
  includeArchived?: boolean;
};

export async function listMachines(params: MachineListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
  const where: Prisma.MachineWhereInput = {};

  if (!params.includeArchived) {
    where.lifecycleStatus = { not: LifecycleStatus.ARCHIVED };
    where.archivedAt = null;
  }

  if (params.serverId) {
    where.serverId = params.serverId;
  }

  if (params.status && params.status !== "ALL") {
    where.lifecycleStatus = params.status;
  }

  if (params.q?.trim()) {
    const q = params.q.trim();
    const asInt = Number.parseInt(q, 10);
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { company: { name: { contains: q, mode: "insensitive" } } },
      { internalIp: { contains: q, mode: "insensitive" } },
      { country: { equals: q.toUpperCase(), mode: "insensitive" } },
      {
        proxyAssignments: {
          some: {
            endedAt: null,
            proxy: { ip: { contains: q } },
          },
        },
      },
      ...(Number.isFinite(asInt) ? [{ vmid: asInt }] : []),
    ];
  }

  const orderBy: Prisma.MachineOrderByWithRelationInput[] = [];
  const order = params.order ?? "asc";
  switch (params.sort) {
    case "company":
      orderBy.push({ company: { name: order } });
      break;
    case "status":
      orderBy.push({ lifecycleStatus: order });
      break;
    case "createdAt":
      orderBy.push({ createdAt: order });
      break;
    case "proxy":
      orderBy.push({ createdAt: "desc" });
      break;
    default:
      orderBy.push({ vmid: order });
  }

  const [total, items] = await Promise.all([
    prisma.machine.count({ where }),
    prisma.machine.findMany({
      where,
      include: {
        server: true,
        company: true,
        proxyAssignments: {
          where: { endedAt: null },
          include: { proxy: true },
          take: 1,
        },
        closure: { include: { items: true } },
        setupChecklist: { include: { items: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { total, page, pageSize, items };
}

export async function getMachine(id: string) {
  const machine = await prisma.machine.findUnique({
    where: { id },
    include: {
      server: true,
      company: true,
      proxyAssignments: {
        include: { proxy: true },
        orderBy: { startedAt: "desc" },
      },
      migrations: {
        include: { fromServer: true, toServer: true },
        orderBy: { createdAt: "desc" },
      },
      closure: {
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          completedBy: true,
        },
      },
      setupChecklist: {
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          completedBy: true,
        },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { actor: true },
      },
    },
  });
  if (!machine) throw new AppError("Machine not found", "NOT_FOUND", 404);
  return machine;
}

async function assertNoActiveConflict(
  tx: Prisma.TransactionClient,
  serverId: string,
  vmid: number,
  excludeId?: string,
) {
  const existing = await tx.machine.findFirst({
    where: {
      serverId,
      vmid,
      archivedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new AppError(
      `Active machine with VMID ${vmid} already exists on this server`,
      "VMID_CONFLICT",
      409,
    );
  }
}

export async function createMachine(
  input: {
    vmid: number;
    displayName?: string;
    serverId: string;
    companyId: string;
    lifecycleStatus?: LifecycleStatus;
    internalIp?: string;
    country?: string | null;
    os?: string;
    notes?: string;
  },
  actorId: string,
) {
  if (!Number.isInteger(input.vmid) || input.vmid <= 0) {
    throw new AppError("VMID must be a positive integer");
  }
  const country = normalizeCountryCode(input.country);
  if (input.country?.trim() && !country) {
    throw new AppError("Country must be a valid ISO 3166-1 alpha-2 code");
  }

  const requested =
    input.lifecycleStatus ?? LifecycleStatus.PREPARING;
  const allowedCreate: LifecycleStatus[] = [
    LifecycleStatus.PREPARING,
    LifecycleStatus.ACTIVE,
    LifecycleStatus.BURNED,
  ];
  if (!allowedCreate.includes(requested)) {
    throw new AppError(
      "New VMs may only be Preparing, Active, or Burned",
      "INVALID_STATUS",
    );
  }

  // Setup checklist only for Preparing — Active/Burned skip fabricated completion
  if (requested === LifecycleStatus.PREPARING) {
    await ensureDefaultSetupTemplate();
  }

  return prisma.$transaction(async (tx) => {
    await assertNoActiveConflict(tx, input.serverId, input.vmid);
    let machine;
    try {
      machine = await tx.machine.create({
        data: {
          vmid: input.vmid,
          displayName: input.displayName?.trim() || null,
          serverId: input.serverId,
          companyId: input.companyId,
          lifecycleStatus: requested,
          internalIp: input.internalIp?.trim() || null,
          country,
          os: input.os?.trim() || null,
          notes: input.notes?.trim() || null,
        },
      });
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : "";
      if (code === "P2002") {
        throw new AppError(
          `Active machine with VMID ${input.vmid} already exists on this server`,
          "VMID_CONFLICT",
          409,
        );
      }
      throw err;
    }

    await logActivity(tx, {
      machineId: machine.id,
      actorId,
      type: "machine.created",
      message: `Created VM ${machine.vmid} (${requested})`,
    });

    if (requested === LifecycleStatus.PREPARING) {
      const template = await tx.checklistTemplate.findFirst({
        where: { kind: ChecklistTemplateKind.SETUP, isDefault: true },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
      if (!template || template.items.length === 0) {
        throw new AppError("No setup checklist template configured");
      }

      await tx.setupChecklist.create({
        data: {
          machineId: machine.id,
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
      });

      await logActivity(tx, {
        machineId: machine.id,
        actorId,
        type: "setup.started",
        message: "Started VM setup checklist",
        metadata: { templateName: template.name },
      });
    }

    return machine;
  });
}

export async function updateMachine(
  id: string,
  input: {
    displayName?: string | null;
    companyId?: string;
    lifecycleStatus?: LifecycleStatus;
    internalIp?: string | null;
    country?: string | null;
    os?: string | null;
    notes?: string | null;
  },
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.machine.findUnique({
      where: { id },
      include: { setupChecklist: { include: { items: true } } },
    });
    if (!current) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (current.lifecycleStatus === LifecycleStatus.ARCHIVED) {
      throw new AppError("Archived machines are read-only", "ARCHIVED", 409);
    }
    if (
      input.lifecycleStatus === LifecycleStatus.ARCHIVED
    ) {
      throw new AppError(
        "Use complete closure to archive a machine",
        "INVALID_STATUS",
      );
    }
    if (input.lifecycleStatus === LifecycleStatus.EXPIRED) {
      throw new AppError(
        "Expired is no longer a valid lifecycle status",
        "INVALID_STATUS",
      );
    }

    if (
      input.lifecycleStatus === LifecycleStatus.ACTIVE &&
      current.setupChecklist &&
      !current.setupChecklist.completedAt
    ) {
      throw new AppError(
        "Finish the setup checklist before marking Active",
        "SETUP_INCOMPLETE",
        409,
      );
    }

    let country: string | null | undefined = undefined;
    if (input.country !== undefined) {
      country = normalizeCountryCode(input.country);
      if (input.country?.trim() && !country) {
        throw new AppError("Country must be a valid ISO 3166-1 alpha-2 code");
      }
    }

    const machine = await tx.machine.update({
      where: { id },
      data: {
        displayName:
          input.displayName === undefined
            ? undefined
            : input.displayName?.trim() || null,
        companyId: input.companyId,
        lifecycleStatus: input.lifecycleStatus,
        internalIp:
          input.internalIp === undefined
            ? undefined
            : input.internalIp?.trim() || null,
        country,
        os: input.os === undefined ? undefined : input.os?.trim() || null,
        notes:
          input.notes === undefined ? undefined : input.notes?.trim() || null,
      },
    });

    await logActivity(tx, {
      machineId: id,
      actorId,
      type: "machine.updated",
      message: `Updated VM ${machine.vmid}`,
      metadata: input as Prisma.InputJsonValue,
    });
    return machine;
  });
}

export async function migrateMachine(
  id: string,
  input: { toServerId: string; toVmid: number; note?: string },
  actorId: string,
) {
  if (!Number.isInteger(input.toVmid) || input.toVmid <= 0) {
    throw new AppError("Target VMID must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.machine.findUnique({ where: { id } });
    if (!current) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (current.archivedAt) {
      throw new AppError("Cannot migrate archived machine", "ARCHIVED", 409);
    }

    await assertNoActiveConflict(tx, input.toServerId, input.toVmid, id);

    await tx.machineMigration.create({
      data: {
        machineId: id,
        fromServerId: current.serverId,
        toServerId: input.toServerId,
        fromVmid: current.vmid,
        toVmid: input.toVmid,
        note: input.note?.trim() || null,
        actorId,
      },
    });

    const machine = await tx.machine.update({
      where: { id },
      data: {
        serverId: input.toServerId,
        vmid: input.toVmid,
      },
    });

    await logActivity(tx, {
      machineId: id,
      actorId,
      type: "machine.migrated",
      message: `Migrated VM ${current.vmid} → ${input.toVmid}`,
      metadata: {
        fromServerId: current.serverId,
        toServerId: input.toServerId,
        fromVmid: current.vmid,
        toVmid: input.toVmid,
      },
    });

    return machine;
  });
}
