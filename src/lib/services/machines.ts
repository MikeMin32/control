import {
  ChecklistItemStatus,
  ChecklistTemplateKind,
  LifecycleStatus,
  ProxyAvailability,
  ProxyKind,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";
import { normalizeCountryCode } from "../countries";
import { normalizeOptionalIpv4 } from "../internal-ip";
import { ensureDefaultSetupTemplate } from "./setup";

function parseInternalIpInput(
  value: string | null | undefined,
): string | null {
  try {
    return normalizeOptionalIpv4(value);
  } catch {
    throw new AppError(
      "Internal IP must be a valid IPv4 address",
      "INVALID_IPV4",
    );
  }
}

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
      { company: { contains: q, mode: "insensitive" } },
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
      orderBy.push({ company: order });
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
    company?: string | null;
    lifecycleStatus?: LifecycleStatus;
    internalIp?: string;
    country?: string | null;
    os?: string;
    notes?: string;
    /** Optional VM-kind proxy to assign on create. Empty/omitted → no assignment. */
    proxyId?: string | null;
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

  if (!input.lifecycleStatus) {
    throw new AppError("Status is required", "INVALID_STATUS");
  }
  const requested = input.lifecycleStatus;
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
  if (!input.serverId?.trim()) {
    throw new AppError("Server is required");
  }

  const company = input.company?.trim() || null;
  const proxyId = input.proxyId?.trim() || null;
  const internalIp = parseInternalIpInput(input.internalIp);

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
          company,
          lifecycleStatus: requested,
          internalIp,
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

    if (proxyId) {
      await assignVmProxyOnCreate(tx, machine.id, proxyId, actorId);
    }

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

/** Initial VM-proxy assignment (same rules as rotateProxy; purchase-source Dolphin untouched). */
async function assignVmProxyOnCreate(
  tx: Prisma.TransactionClient,
  machineId: string,
  proxyId: string,
  actorId: string,
) {
  const proxy = await tx.proxy.findUnique({
    where: { id: proxyId },
    include: { assignments: { where: { endedAt: null } } },
  });
  if (!proxy) throw new AppError("Proxy not found", "NOT_FOUND", 404);
  if (proxy.kind !== ProxyKind.VM) {
    throw new AppError(
      "Only VM proxies can be assigned to machines",
      "WRONG_PROXY_KIND",
    );
  }
  if (proxy.availability === ProxyAvailability.RETIRED) {
    throw new AppError("Cannot assign a retired proxy", "PROXY_RETIRED");
  }
  if (proxy.assignments.length > 0) {
    throw new AppError(
      "Proxy is already assigned to another VM",
      "PROXY_IN_USE",
      409,
    );
  }

  const claimed = await tx.proxy.updateMany({
    where: {
      id: proxyId,
      availability: ProxyAvailability.AVAILABLE,
    },
    data: { availability: ProxyAvailability.ASSIGNED },
  });
  if (claimed.count !== 1) {
    throw new AppError("Proxy could not be claimed", "PROXY_CLAIM_FAILED", 409);
  }

  const stillOpen = await tx.proxyAssignment.count({
    where: { proxyId, endedAt: null },
  });
  if (stillOpen > 0) {
    throw new AppError(
      "Proxy is already assigned to another VM",
      "PROXY_IN_USE",
      409,
    );
  }

  let assignment;
  try {
    assignment = await tx.proxyAssignment.create({
      data: {
        machineId,
        proxyId,
        reason: "Initial assignment",
        actorId,
      },
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "P2002") {
      throw new AppError(
        "Concurrent proxy assignment conflict",
        "PROXY_CONFLICT",
        409,
      );
    }
    throw err;
  }

  await logActivity(tx, {
    machineId,
    actorId,
    type: "proxy.rotated",
    message: `Assigned proxy ${proxy.ip}`,
    metadata: {
      proxyId: proxy.id,
      assignmentId: assignment.id,
      reason: "Initial assignment",
    },
  });
}

export async function updateMachine(
  id: string,
  input: {
    displayName?: string | null;
    company?: string | null;
    lifecycleStatus?: LifecycleStatus;
    internalIp?: string | null;
    country?: string | null;
    os?: string | null;
    notes?: string | null;
    /** Direct inventory server change (no migration record / Proxmox). */
    serverId?: string;
    /**
     * Direct proxy assignment edit.
     * undefined = leave unchanged; null/"" = unassign; id = assign/replace.
     * Does not invoke rotation/billing workflows.
     */
    proxyId?: string | null;
  },
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.machine.findUnique({
      where: { id },
      include: {
        server: true,
        setupChecklist: { include: { items: true } },
        proxyAssignments: {
          where: { endedAt: null },
          include: { proxy: true },
          take: 1,
        },
      },
    });
    if (!current) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (current.lifecycleStatus === LifecycleStatus.ARCHIVED) {
      throw new AppError("Archived machines are read-only", "ARCHIVED", 409);
    }
    if (input.lifecycleStatus === LifecycleStatus.ARCHIVED) {
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

    const internalIp =
      input.internalIp === undefined
        ? undefined
        : parseInternalIpInput(input.internalIp);

    let nextServerId: string | undefined = undefined;
    let fromServerName: string | null = null;
    let toServerName: string | null = null;
    if (input.serverId !== undefined) {
      const serverId = input.serverId.trim();
      if (!serverId) throw new AppError("Server is required");
      if (serverId !== current.serverId) {
        const server = await tx.server.findUnique({ where: { id: serverId } });
        if (!server) throw new AppError("Server not found", "NOT_FOUND", 404);
        await assertNoActiveConflict(tx, serverId, current.vmid, id);
        nextServerId = serverId;
        fromServerName = current.server.name;
        toServerName = server.name;
      }
    }

    const data: Prisma.MachineUpdateInput = {
      displayName:
        input.displayName === undefined
          ? undefined
          : input.displayName?.trim() || null,
      company:
        input.company === undefined
          ? undefined
          : input.company?.trim() || null,
      lifecycleStatus: input.lifecycleStatus,
      internalIp,
      country,
      os: input.os === undefined ? undefined : input.os?.trim() || null,
      notes:
        input.notes === undefined ? undefined : input.notes?.trim() || null,
    };
    if (nextServerId) {
      data.server = { connect: { id: nextServerId } };
    }

    const machine = await tx.machine.update({
      where: { id },
      data,
    });

    const currentProxy = current.proxyAssignments[0] ?? null;
    if (input.proxyId !== undefined) {
      await applyManualProxyEdit(tx, {
        machineId: id,
        actorId,
        currentAssignment: currentProxy,
        nextProxyId: input.proxyId?.trim() || null,
      });
    }

    if (nextServerId && fromServerName && toServerName) {
      await logActivity(tx, {
        machineId: id,
        actorId,
        type: "machine.server_updated",
        message: "Server updated",
        metadata: {
          fromServerId: current.serverId,
          toServerId: nextServerId,
          fromServerName,
          toServerName,
        },
      });
    }

    if (internalIp !== undefined && (current.internalIp || null) !== internalIp) {
      await logActivity(tx, {
        machineId: id,
        actorId,
        type: "machine.internal_ip_updated",
        message: "Internal IP updated",
        metadata: {
          from: current.internalIp,
          to: internalIp,
        },
      });
    }

    const otherChanged =
      (input.displayName !== undefined &&
        (current.displayName || null) !==
          (input.displayName?.trim() || null)) ||
      (input.company !== undefined &&
        (current.company || null) !== (input.company?.trim() || null)) ||
      (input.lifecycleStatus !== undefined &&
        current.lifecycleStatus !== input.lifecycleStatus) ||
      (country !== undefined && (current.country || null) !== country) ||
      (input.os !== undefined &&
        (current.os || null) !== (input.os?.trim() || null)) ||
      (input.notes !== undefined &&
        (current.notes || null) !== (input.notes?.trim() || null));

    if (otherChanged) {
      await logActivity(tx, {
        machineId: id,
        actorId,
        type: "machine.updated",
        message: `Updated VM ${machine.vmid}`,
        metadata: {
          displayName: input.displayName,
          company: input.company,
          lifecycleStatus: input.lifecycleStatus,
          country,
          os: input.os,
          notes: input.notes,
        } as Prisma.InputJsonValue,
      });
    }

    return machine;
  });
}

const MANUAL_PROXY_REASON = "Manual edit";

async function applyManualProxyEdit(
  tx: Prisma.TransactionClient,
  opts: {
    machineId: string;
    actorId: string;
    currentAssignment: {
      id: string;
      proxyId: string;
      proxy: { id: string; ip: string; purchaseSourceDolphinId: string | null };
    } | null;
    nextProxyId: string | null;
  },
) {
  const { machineId, actorId, currentAssignment, nextProxyId } = opts;
  const currentProxyId = currentAssignment?.proxyId ?? null;
  if (currentProxyId === nextProxyId) return;

  // Unassign / close previous
  if (currentAssignment) {
    await tx.proxyAssignment.update({
      where: { id: currentAssignment.id },
      data: { endedAt: new Date(), reason: MANUAL_PROXY_REASON },
    });
    await tx.proxy.update({
      where: { id: currentAssignment.proxyId },
      data: { availability: ProxyAvailability.AVAILABLE },
    });
  }

  if (!nextProxyId) {
    await logActivity(tx, {
      machineId,
      actorId,
      type: "proxy.unassigned",
      message: "Proxy unassigned",
      metadata: {
        fromProxyId: currentAssignment?.proxyId ?? null,
        fromProxyIp: currentAssignment?.proxy.ip ?? null,
        reason: MANUAL_PROXY_REASON,
      },
    });
    return;
  }

  const proxy = await tx.proxy.findUnique({
    where: { id: nextProxyId },
    include: { assignments: { where: { endedAt: null } } },
  });
  if (!proxy) throw new AppError("Proxy not found", "NOT_FOUND", 404);
  if (proxy.kind !== ProxyKind.VM) {
    throw new AppError(
      "Only VM proxies can be assigned to machines",
      "WRONG_PROXY_KIND",
    );
  }
  if (proxy.availability === ProxyAvailability.RETIRED) {
    throw new AppError("Cannot assign a retired proxy", "PROXY_RETIRED");
  }
  const foreignOpen = proxy.assignments.filter((a) => a.machineId !== machineId);
  if (foreignOpen.length > 0) {
    throw new AppError(
      "Proxy is already assigned to another VM",
      "PROXY_IN_USE",
      409,
    );
  }

  const claimed = await tx.proxy.updateMany({
    where: {
      id: nextProxyId,
      availability: {
        in: [ProxyAvailability.AVAILABLE, ProxyAvailability.ASSIGNED],
      },
    },
    data: { availability: ProxyAvailability.ASSIGNED },
  });
  if (claimed.count !== 1) {
    throw new AppError("Proxy could not be claimed", "PROXY_CLAIM_FAILED", 409);
  }

  const stillOpen = await tx.proxyAssignment.count({
    where: { proxyId: nextProxyId, endedAt: null },
  });
  if (stillOpen > 0) {
    throw new AppError(
      "Proxy is already assigned to another VM",
      "PROXY_IN_USE",
      409,
    );
  }

  let assignment;
  try {
    assignment = await tx.proxyAssignment.create({
      data: {
        machineId,
        proxyId: nextProxyId,
        reason: MANUAL_PROXY_REASON,
        actorId,
      },
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "P2002") {
      throw new AppError(
        "Concurrent proxy assignment conflict",
        "PROXY_CONFLICT",
        409,
      );
    }
    throw err;
  }

  if (currentAssignment) {
    await logActivity(tx, {
      machineId,
      actorId,
      type: "proxy.updated",
      message: "Proxy updated",
      metadata: {
        fromProxyId: currentAssignment.proxyId,
        fromProxyIp: currentAssignment.proxy.ip,
        toProxyId: proxy.id,
        toProxyIp: proxy.ip,
        assignmentId: assignment.id,
        reason: MANUAL_PROXY_REASON,
        purchaseSourceDolphinId: proxy.purchaseSourceDolphinId,
      },
    });
  } else {
    await logActivity(tx, {
      machineId,
      actorId,
      type: "proxy.assigned",
      message: "Proxy assigned",
      metadata: {
        proxyId: proxy.id,
        proxyIp: proxy.ip,
        assignmentId: assignment.id,
        reason: MANUAL_PROXY_REASON,
        purchaseSourceDolphinId: proxy.purchaseSourceDolphinId,
      },
    });
  }
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
