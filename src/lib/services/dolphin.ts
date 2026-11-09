import type { Prisma } from "@prisma/client";
import { ProxyAvailability } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";

export type DolphinInput = {
  accountName: string;
  machineId?: string | null;
  /** Optional human wallet label. */
  wallet?: string | null;
  /** Public address. */
  walletAddress?: string | null;
  network?: string | null;
  notes?: string | null;
};

function normalizeInput(input: DolphinInput) {
  const accountName = input.accountName.trim();
  if (!accountName) throw new AppError("Account name is required");
  return {
    accountName,
    machineId: input.machineId?.trim() || null,
    wallet: input.wallet?.trim() || null,
    walletAddress: input.walletAddress?.trim() || null,
    network: input.network?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

async function assertMachineExists(
  tx: Prisma.TransactionClient,
  machineId: string | null,
) {
  if (!machineId) return;
  const machine = await tx.machine.findUnique({ where: { id: machineId } });
  if (!machine) throw new AppError("Linked VM not found", "NOT_FOUND", 404);
}

/** Plain-text linked VM label for selectors: `101 · Company` (or just VMID). */
export function linkedVmOptionLabel(m: {
  vmid: number;
  company?: string | null;
}): string {
  const company = m.company?.trim();
  return company ? `${m.vmid} · ${company}` : String(m.vmid);
}

export async function listLinkableMachines() {
  return prisma.machine.findMany({
    include: { server: true },
    orderBy: [{ vmid: "asc" }, { displayName: "asc" }],
  });
}

/** Active (non-retired) Dolphins for purchase-source / connection selectors. */
export async function listActiveDolphinAccounts() {
  return prisma.dolphinAccount.findMany({
    where: { retiredAt: null },
    orderBy: [{ accountName: "asc" }],
  });
}

export async function listDolphinAccounts(params?: {
  q?: string;
  includeRetired?: boolean;
}) {
  const q = params?.q?.trim();
  const and: Prisma.DolphinAccountWhereInput[] = [];
  if (!params?.includeRetired) {
    and.push({ retiredAt: null });
  }
  if (q) {
    and.push({
      OR: [
        { accountName: { contains: q, mode: "insensitive" } },
        { wallet: { contains: q, mode: "insensitive" } },
        { walletAddress: { contains: q, mode: "insensitive" } },
        { network: { contains: q, mode: "insensitive" } },
        {
          machine: {
            OR: [
              { company: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              ...(Number.isFinite(Number.parseInt(q, 10))
                ? [{ vmid: Number.parseInt(q, 10) }]
                : []),
            ],
          },
        },
      ],
    });
  }
  const where: Prisma.DolphinAccountWhereInput =
    and.length === 0 ? {} : and.length === 1 ? and[0]! : { AND: and };

  return prisma.dolphinAccount.findMany({
    where,
    include: {
      machine: {
        include: { server: true },
      },
      proxyAssignments: {
        where: { endedAt: null },
        include: { proxy: true },
        take: 1,
      },
      _count: {
        select: {
          purchaseSourceProxies: true,
          proxyAssignments: true,
        },
      },
    },
    orderBy: [{ accountName: "asc" }],
  });
}

export async function getDolphinAccount(id: string) {
  const row = await prisma.dolphinAccount.findUnique({
    where: { id },
    include: {
      machine: { include: { server: true } },
      proxyAssignments: {
        where: { endedAt: null },
        include: { proxy: true },
        take: 1,
      },
      _count: {
        select: {
          purchaseSourceProxies: true,
          proxyAssignments: true,
        },
      },
    },
  });
  if (!row) throw new AppError("Dolphin account not found", "NOT_FOUND", 404);
  return row;
}

export async function createDolphinAccount(
  input: DolphinInput,
  actorId: string,
) {
  const data = normalizeInput(input);
  return prisma.$transaction(async (tx) => {
    await assertMachineExists(tx, data.machineId);
    const row = await tx.dolphinAccount.create({ data });
    await logActivity(tx, {
      machineId: data.machineId,
      actorId,
      type: "dolphin.created",
      message: `Created Dolphin account “${row.accountName}”`,
      metadata: { dolphinId: row.id },
    });
    return row;
  });
}

export async function updateDolphinAccount(
  id: string,
  input: DolphinInput,
  actorId: string,
) {
  const data = normalizeInput(input);
  return prisma.$transaction(async (tx) => {
    const current = await tx.dolphinAccount.findUnique({ where: { id } });
    if (!current) throw new AppError("Dolphin account not found", "NOT_FOUND", 404);
    if (current.retiredAt) {
      throw new AppError("Cannot edit a retired Dolphin account", "DOLPHIN_RETIRED");
    }
    await assertMachineExists(tx, data.machineId);
    const row = await tx.dolphinAccount.update({ where: { id }, data });
    await logActivity(tx, {
      machineId: data.machineId ?? current.machineId,
      actorId,
      type: "dolphin.updated",
      message: `Updated Dolphin account “${row.accountName}”`,
      metadata: { dolphinId: row.id },
    });
    return row;
  });
}

async function dolphinReferenceCounts(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const [purchaseCount, openConnection, anyConnection] = await Promise.all([
    tx.proxy.count({ where: { purchaseSourceDolphinId: id } }),
    tx.dolphinProxyAssignment.count({
      where: { dolphinId: id, endedAt: null },
    }),
    tx.dolphinProxyAssignment.count({ where: { dolphinId: id } }),
  ]);
  return { purchaseCount, openConnection, anyConnection };
}

/**
 * Hard-delete only when unreferenced (no purchase-source proxies, no connection history).
 * Referenced profiles must be retired instead.
 */
export async function deleteDolphinAccount(id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.dolphinAccount.findUnique({ where: { id } });
    if (!current) throw new AppError("Dolphin account not found", "NOT_FOUND", 404);

    const refs = await dolphinReferenceCounts(tx, id);
    if (
      refs.purchaseCount > 0 ||
      refs.openConnection > 0 ||
      refs.anyConnection > 0
    ) {
      throw new AppError(
        "This Dolphin is referenced by proxies — retire it instead of deleting",
        "DOLPHIN_REFERENCED",
      );
    }

    await tx.dolphinAccount.delete({ where: { id } });
    await logActivity(tx, {
      machineId: current.machineId,
      actorId,
      type: "dolphin.deleted",
      message: `Deleted Dolphin account “${current.accountName}”`,
      metadata: { dolphinId: id },
    });
  });
}

/**
 * Soft-retire a Dolphin. Ends any open connection-proxy assignment
 * (proxy returns to AVAILABLE). Purchase-source links are preserved.
 */
export async function retireDolphinAccount(id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.dolphinAccount.findUnique({ where: { id } });
    if (!current) throw new AppError("Dolphin account not found", "NOT_FOUND", 404);
    if (current.retiredAt) {
      throw new AppError("Dolphin account is already retired", "DOLPHIN_RETIRED");
    }

    const open = await tx.dolphinProxyAssignment.findMany({
      where: { dolphinId: id, endedAt: null },
    });
    for (const a of open) {
      await tx.dolphinProxyAssignment.update({
        where: { id: a.id },
        data: { endedAt: new Date(), reason: "Dolphin retired" },
      });
      await tx.proxy.update({
        where: { id: a.proxyId },
        data: { availability: ProxyAvailability.AVAILABLE },
      });
    }

    const row = await tx.dolphinAccount.update({
      where: { id },
      data: { retiredAt: new Date() },
    });
    await logActivity(tx, {
      machineId: current.machineId,
      actorId,
      type: "dolphin.retired",
      message: `Retired Dolphin account “${current.accountName}”`,
      metadata: { dolphinId: id },
    });
    return row;
  });
}
