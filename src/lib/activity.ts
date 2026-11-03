import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

export async function logActivity(
  tx: Prisma.TransactionClient | typeof prisma,
  opts: {
    machineId?: string | null;
    actorId?: string | null;
    type: string;
    message: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.activityEvent.create({
    data: {
      machineId: opts.machineId ?? null,
      actorId: opts.actorId ?? null,
      type: opts.type,
      message: opts.message,
      metadata: opts.metadata,
    },
  });
}
