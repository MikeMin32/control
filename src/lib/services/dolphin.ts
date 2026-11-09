import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";

export type DolphinInput = {
  accountName: string;
  machineId?: string | null;
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

export async function listLinkableMachines() {
  return prisma.machine.findMany({
    include: { server: true, company: true },
    orderBy: [{ vmid: "asc" }, { displayName: "asc" }],
  });
}

export async function listDolphinAccounts(params?: { q?: string }) {
  const q = params?.q?.trim();
  const where: Prisma.DolphinAccountWhereInput = q
    ? {
        OR: [
          { accountName: { contains: q, mode: "insensitive" } },
          { walletAddress: { contains: q, mode: "insensitive" } },
          { network: { contains: q, mode: "insensitive" } },
          {
            machine: {
              OR: [
                { displayName: { contains: q, mode: "insensitive" } },
                ...(Number.isFinite(Number.parseInt(q, 10))
                  ? [{ vmid: Number.parseInt(q, 10) }]
                  : []),
              ],
            },
          },
        ],
      }
    : {};

  return prisma.dolphinAccount.findMany({
    where,
    include: {
      machine: {
        include: { server: true, company: true },
      },
    },
    orderBy: [{ accountName: "asc" }],
  });
}

export async function getDolphinAccount(id: string) {
  const row = await prisma.dolphinAccount.findUnique({
    where: { id },
    include: {
      machine: { include: { server: true, company: true } },
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

export async function deleteDolphinAccount(id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.dolphinAccount.findUnique({ where: { id } });
    if (!current) throw new AppError("Dolphin account not found", "NOT_FOUND", 404);
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
