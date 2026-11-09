import {
  ProxyAvailability,
  ProxyKind,
  type BillingStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";

export async function listProxies(params?: {
  availability?: ProxyAvailability | "ALL";
  kind?: ProxyKind | "ALL";
  q?: string;
}) {
  const where: Prisma.ProxyWhereInput = {};
  if (params?.availability && params.availability !== "ALL") {
    where.availability = params.availability;
  }
  if (params?.kind && params.kind !== "ALL") {
    where.kind = params.kind;
  }
  if (params?.q?.trim()) {
    const q = params.q.trim();
    where.OR = [
      { ip: { contains: q } },
      { provider: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { country: { contains: q, mode: "insensitive" } },
    ];
  }
  return prisma.proxy.findMany({
    where,
    include: {
      purchaseSourceDolphin: true,
      assignments: {
        where: { endedAt: null },
        include: { machine: { include: { server: true, company: true } } },
        take: 1,
      },
      dolphinAssignments: {
        where: { endedAt: null },
        include: { dolphin: true },
        take: 1,
      },
    },
    orderBy: [{ availability: "asc" }, { ip: "asc" }],
  });
}

export async function createProxy(
  input: {
    ip: string;
    provider: string;
    kind?: ProxyKind;
    purchaseSourceDolphinId?: string | null;
    endpointHostname?: string;
    endpointPort?: number;
    country?: string;
    region?: string;
    city?: string;
    renewalDate?: string | null;
    monthlyCost?: number | null;
    currency?: string;
    notes?: string;
    billingStatus?: BillingStatus;
  },
  actorId: string,
) {
  const ip = input.ip.trim();
  if (!ip) throw new AppError("IP is required");
  const provider = input.provider.trim();
  if (!provider) throw new AppError("Provider is required");

  const kind = input.kind ?? ProxyKind.VM;
  let purchaseSourceDolphinId: string | null = null;

  if (kind === ProxyKind.VM) {
    const src = input.purchaseSourceDolphinId?.trim() || "";
    if (!src) {
      throw new AppError(
        "Purchase-source Dolphin is required for VM proxies",
        "PURCHASE_SOURCE_REQUIRED",
      );
    }
    const dolphin = await prisma.dolphinAccount.findUnique({ where: { id: src } });
    if (!dolphin) {
      throw new AppError("Purchase-source Dolphin not found", "NOT_FOUND", 404);
    }
    if (dolphin.retiredAt) {
      throw new AppError(
        "Cannot use a retired Dolphin as purchase source",
        "DOLPHIN_RETIRED",
      );
    }
    purchaseSourceDolphinId = src;
  } else if (input.purchaseSourceDolphinId?.trim()) {
    throw new AppError(
      "Purchase-source Dolphin applies only to VM proxies",
      "INVALID_PURCHASE_SOURCE",
    );
  }

  const proxy = await prisma.proxy.create({
    data: {
      ip,
      provider,
      kind,
      purchaseSourceDolphinId,
      endpointHostname: input.endpointHostname?.trim() || null,
      endpointPort: input.endpointPort ?? null,
      country: input.country?.trim() || null,
      region: input.region?.trim() || null,
      city: input.city?.trim() || null,
      renewalDate: input.renewalDate ? new Date(input.renewalDate) : null,
      monthlyCost: input.monthlyCost ?? null,
      currency: input.currency || "USD",
      notes: input.notes?.trim() || null,
      billingStatus: input.billingStatus,
      availability: ProxyAvailability.AVAILABLE,
    },
  });

  await logActivity(prisma, {
    actorId,
    type: "proxy.created",
    message: `Created ${kind.toLowerCase()} proxy ${proxy.ip}`,
    metadata: {
      proxyId: proxy.id,
      kind,
      purchaseSourceDolphinId,
    },
  });

  return proxy;
}

export async function updateProxyBilling(
  id: string,
  billingStatus: BillingStatus,
  actorId: string,
) {
  const proxy = await prisma.proxy.update({
    where: { id },
    data: { billingStatus },
  });
  await logActivity(prisma, {
    actorId,
    type: "proxy.billing_updated",
    message: `Proxy ${proxy.ip} billing → ${billingStatus}`,
    metadata: { proxyId: id, billingStatus },
  });
  return proxy;
}

export async function retireProxy(id: string, actorId: string) {
  const current = await prisma.proxy.findUnique({
    where: { id },
    include: {
      assignments: { where: { endedAt: null } },
      dolphinAssignments: { where: { endedAt: null } },
    },
  });
  if (!current) throw new AppError("Proxy not found", "NOT_FOUND", 404);
  if (current.assignments.length > 0) {
    throw new AppError("Cannot retire an assigned proxy", "PROXY_ASSIGNED");
  }
  if (current.dolphinAssignments.length > 0) {
    throw new AppError(
      "Cannot retire a proxy assigned as a Dolphin connection",
      "PROXY_ASSIGNED",
    );
  }
  const proxy = await prisma.proxy.update({
    where: { id },
    data: { availability: ProxyAvailability.RETIRED },
  });
  await logActivity(prisma, {
    actorId,
    type: "proxy.retired",
    message: `Retired proxy ${proxy.ip}`,
    metadata: { proxyId: id },
  });
  return proxy;
}

/** Warn (not block) when IP appeared in previous assignment history. */
export async function findIpHistory(ip: string, excludeMachineId?: string) {
  return prisma.proxyAssignment.findMany({
    where: {
      proxy: { ip },
      ...(excludeMachineId ? { machineId: { not: excludeMachineId } } : {}),
    },
    include: {
      machine: { include: { server: true, company: true } },
      proxy: true,
    },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
}

/**
 * Atomically end current machine assignment (if any) and start a new one.
 * Only VM-kind proxies may be assigned to machines.
 * Rejects: already-assigned proxy, rotating to current proxy, concurrent corruption.
 */
export async function rotateProxy(
  machineId: string,
  input: { proxyId: string; reason: string },
  actorId: string,
) {
  const reason = input.reason.trim();
  if (!reason) throw new AppError("Replacement reason is required");

  return prisma.$transaction(async (tx) => {
    const machine = await tx.machine.findUnique({ where: { id: machineId } });
    if (!machine) throw new AppError("Machine not found", "NOT_FOUND", 404);
    if (machine.archivedAt) {
      throw new AppError("Cannot rotate proxy on archived machine", "ARCHIVED");
    }

    const proxy = await tx.proxy.findUnique({
      where: { id: input.proxyId },
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

    const openOnMachine = await tx.proxyAssignment.findMany({
      where: { machineId, endedAt: null },
    });

    if (openOnMachine.some((a) => a.proxyId === input.proxyId)) {
      throw new AppError(
        "Proxy is already the current assignment",
        "SAME_PROXY",
      );
    }

    const foreignOpen = proxy.assignments.filter(
      (a) => a.machineId !== machineId,
    );
    if (foreignOpen.length > 0) {
      throw new AppError(
        "Proxy is already assigned to another VM",
        "PROXY_IN_USE",
        409,
      );
    }

    // End previous assignments
    for (const a of openOnMachine) {
      await tx.proxyAssignment.update({
        where: { id: a.id },
        data: { endedAt: new Date(), reason },
      });
      await tx.proxy.update({
        where: { id: a.proxyId },
        data: { availability: ProxyAvailability.AVAILABLE },
      });
    }

    // Re-check proxy open assignments under row lock via update
    const claimed = await tx.proxy.updateMany({
      where: {
        id: input.proxyId,
        availability: {
          in: [ProxyAvailability.AVAILABLE, ProxyAvailability.ASSIGNED],
        },
      },
      data: { availability: ProxyAvailability.ASSIGNED },
    });
    if (claimed.count !== 1) {
      throw new AppError("Proxy could not be claimed", "PROXY_CLAIM_FAILED", 409);
    }

    // Ensure no concurrent open assignment on this proxy
    const stillOpen = await tx.proxyAssignment.count({
      where: {
        proxyId: input.proxyId,
        endedAt: null,
      },
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
          proxyId: input.proxyId,
          reason,
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
          "Concurrent proxy rotation conflict",
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
      message: `Rotated proxy to ${proxy.ip}`,
      metadata: {
        proxyId: proxy.id,
        assignmentId: assignment.id,
        reason,
      },
    });

    return assignment;
  });
}

/**
 * Assign / rotate the current connection proxy for a Dolphin account.
 * Only DOLPHIN-kind proxies; 1:1 current per Dolphin and per proxy.
 * Preserves assignment history (endedAt + reason).
 */
export async function rotateDolphinConnectionProxy(
  dolphinId: string,
  input: { proxyId: string; reason: string },
  actorId: string,
) {
  const reason = input.reason.trim();
  if (!reason) throw new AppError("Replacement reason is required");

  return prisma.$transaction(async (tx) => {
    const dolphin = await tx.dolphinAccount.findUnique({
      where: { id: dolphinId },
    });
    if (!dolphin) {
      throw new AppError("Dolphin account not found", "NOT_FOUND", 404);
    }
    if (dolphin.retiredAt) {
      throw new AppError(
        "Cannot assign a connection proxy to a retired Dolphin",
        "DOLPHIN_RETIRED",
      );
    }

    const proxy = await tx.proxy.findUnique({
      where: { id: input.proxyId },
      include: { dolphinAssignments: { where: { endedAt: null } } },
    });
    if (!proxy) throw new AppError("Proxy not found", "NOT_FOUND", 404);
    if (proxy.kind !== ProxyKind.DOLPHIN) {
      throw new AppError(
        "Only Dolphin proxies can be used as connection proxies",
        "WRONG_PROXY_KIND",
      );
    }
    if (proxy.availability === ProxyAvailability.RETIRED) {
      throw new AppError("Cannot assign a retired proxy", "PROXY_RETIRED");
    }

    const openOnDolphin = await tx.dolphinProxyAssignment.findMany({
      where: { dolphinId, endedAt: null },
    });

    if (openOnDolphin.some((a) => a.proxyId === input.proxyId)) {
      throw new AppError(
        "Proxy is already the current connection proxy",
        "SAME_PROXY",
      );
    }

    const foreignOpen = proxy.dolphinAssignments.filter(
      (a) => a.dolphinId !== dolphinId,
    );
    if (foreignOpen.length > 0) {
      throw new AppError(
        "Proxy is already assigned to another Dolphin",
        "PROXY_IN_USE",
        409,
      );
    }

    for (const a of openOnDolphin) {
      await tx.dolphinProxyAssignment.update({
        where: { id: a.id },
        data: { endedAt: new Date(), reason },
      });
      await tx.proxy.update({
        where: { id: a.proxyId },
        data: { availability: ProxyAvailability.AVAILABLE },
      });
    }

    const claimed = await tx.proxy.updateMany({
      where: {
        id: input.proxyId,
        availability: {
          in: [ProxyAvailability.AVAILABLE, ProxyAvailability.ASSIGNED],
        },
      },
      data: { availability: ProxyAvailability.ASSIGNED },
    });
    if (claimed.count !== 1) {
      throw new AppError("Proxy could not be claimed", "PROXY_CLAIM_FAILED", 409);
    }

    const stillOpen = await tx.dolphinProxyAssignment.count({
      where: { proxyId: input.proxyId, endedAt: null },
    });
    if (stillOpen > 0) {
      throw new AppError(
        "Proxy is already assigned to another Dolphin",
        "PROXY_IN_USE",
        409,
      );
    }

    let assignment;
    try {
      assignment = await tx.dolphinProxyAssignment.create({
        data: {
          dolphinId,
          proxyId: input.proxyId,
          reason,
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
          "Concurrent Dolphin proxy assignment conflict",
          "PROXY_CONFLICT",
          409,
        );
      }
      throw err;
    }

    await logActivity(tx, {
      machineId: dolphin.machineId,
      actorId,
      type: "dolphin.proxy_rotated",
      message: `Assigned connection proxy ${proxy.ip} to Dolphin “${dolphin.accountName}”`,
      metadata: {
        dolphinId,
        proxyId: proxy.id,
        assignmentId: assignment.id,
        reason,
      },
    });

    return assignment;
  });
}

export async function listUnresolvedCancellations() {
  return prisma.proxy.findMany({
    where: { billingStatus: "CANCELLATION_PENDING" },
    orderBy: { updatedAt: "desc" },
  });
}
