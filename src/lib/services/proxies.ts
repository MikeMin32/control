import {
  ProxyAvailability,
  type BillingStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";

export async function listProxies(params?: {
  availability?: ProxyAvailability | "ALL";
  q?: string;
}) {
  const where: Prisma.ProxyWhereInput = {};
  if (params?.availability && params.availability !== "ALL") {
    where.availability = params.availability;
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
      assignments: {
        where: { endedAt: null },
        include: { machine: { include: { server: true, company: true } } },
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

  const proxy = await prisma.proxy.create({
    data: {
      ip,
      provider,
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
    message: `Created proxy ${proxy.ip}`,
    metadata: { proxyId: proxy.id },
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
    include: { assignments: { where: { endedAt: null } } },
  });
  if (!current) throw new AppError("Proxy not found", "NOT_FOUND", 404);
  if (current.assignments.length > 0) {
    throw new AppError("Cannot retire an assigned proxy", "PROXY_ASSIGNED");
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
 * Atomically end current assignment (if any) and start a new one.
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
        availability: { in: [ProxyAvailability.AVAILABLE, ProxyAvailability.ASSIGNED] },
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

export async function listUnresolvedCancellations() {
  return prisma.proxy.findMany({
    where: { billingStatus: "CANCELLATION_PENDING" },
    orderBy: { updatedAt: "desc" },
  });
}
