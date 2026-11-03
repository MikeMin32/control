import { prisma } from "../db";
import { AppError } from "../errors";
import { hashPassword, verifyPassword } from "../auth";
import { ensureDefaultTemplate } from "./wipeout";

export async function getOrCreateSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.appSettings.create({
    data: { id: 1, displayTimezone: "Europe/Kyiv" },
  });
}

export async function updateTimezone(displayTimezone: string) {
  const tz = displayTimezone.trim();
  if (!tz) throw new AppError("Timezone is required");
  await getOrCreateSettings();
  return prisma.appSettings.update({
    where: { id: 1 },
    data: { displayTimezone: tz },
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  if (newPassword.length < 10) {
    throw new AppError("New password must be at least 10 characters");
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("User not found", "NOT_FOUND", 404);
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw new AppError("Current password is incorrect", "BAD_PASSWORD");
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
  // Invalidate other sessions optionally — keep current for UX
}

export async function listServers() {
  return prisma.server.findMany({ orderBy: { name: "asc" } });
}

export async function createServer(name: string, notes?: string) {
  const n = name.trim();
  if (!n) throw new AppError("Server name is required");
  return prisma.server.create({
    data: { name: n, notes: notes?.trim() || null },
  });
}

export async function retireServer(id: string) {
  const count = await prisma.machine.count({
    where: { serverId: id, archivedAt: null },
  });
  if (count > 0) {
    throw new AppError(
      "Cannot retire a server that still has non-archived machines",
      "SERVER_IN_USE",
    );
  }
  return prisma.server.update({
    where: { id },
    data: { retiredAt: new Date() },
  });
}

export async function listCompanies() {
  return prisma.company.findMany({ orderBy: { name: "asc" } });
}

export async function createCompany(name: string, notes?: string) {
  const n = name.trim();
  if (!n) throw new AppError("Company name is required");
  return prisma.company.create({
    data: { name: n, notes: notes?.trim() || null },
  });
}

export async function getTemplateEditor() {
  return ensureDefaultTemplate();
}

export async function updateTemplateItems(
  templateId: string,
  items: { id?: string; label: string; required: boolean; sortOrder: number }[],
) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.checklistTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) throw new AppError("Template not found", "NOT_FOUND", 404);

    await tx.checklistTemplateItem.deleteMany({ where: { templateId } });
    await tx.checklistTemplateItem.createMany({
      data: items.map((item, i) => ({
        templateId,
        label: item.label.trim(),
        required: item.required,
        sortOrder: item.sortOrder ?? i,
      })),
    });

    return tx.checklistTemplate.findUnique({
      where: { id: templateId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  });
}
