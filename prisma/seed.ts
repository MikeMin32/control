/**
 * Idempotent development seed. Safe to re-run.
 * Uses documentation IP ranges only. Does not fake a live Proxmox connection.
 */
import {
  BillingStatus,
  ChecklistItemStatus,
  ClosureReason,
  LifecycleStatus,
  PrismaClient,
  ProxyAvailability,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertServer(name: string) {
  return prisma.server.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

async function upsertCompany(name: string) {
  return prisma.company.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

async function main() {
  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, displayTimezone: "Europe/Kyiv" },
  });

  const defaultItems = [
    "Proxy subscription cancelled or renewal disabled.",
    "Proxy configuration removed.",
    "Browser/application profiles removed.",
    "Associated email accounts removed or detached as appropriate.",
    "VM deleted or prepared for reuse.",
    "Relevant network rules and access removed.",
  ];

  let template = await prisma.checklistTemplate.findFirst({
    where: { isDefault: true },
  });
  if (!template) {
    template = await prisma.checklistTemplate.create({
      data: {
        name: "Default wipeout",
        isDefault: true,
        items: {
          create: defaultItems.map((label, i) => ({
            label,
            required: true,
            sortOrder: i,
          })),
        },
      },
    });
  }

  const s1 = await upsertServer("1tech2");
  const s2 = await upsertServer("xeon");
  const cAlpha = await upsertCompany("Alpha Labs");
  const cBeta = await upsertCompany("Beta Retail");
  const cGamma = await upsertCompany("Gamma Media");

  const adminEmail = "admin@example.com";
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        displayName: "Admin",
        passwordHash: await bcrypt.hash("changeme-admin-pass", 12),
      },
    });
    console.log(
      "Seeded demo admin admin@example.com / changeme-admin-pass (dev only)",
    );
  }

  // Proxies
  async function upsertProxy(
    ip: string,
    provider: string,
    data: {
      availability: ProxyAvailability;
      billingStatus: BillingStatus;
      renewalDate?: Date;
      city?: string;
      country?: string;
    },
  ) {
    return prisma.proxy.upsert({
      where: { ip_provider: { ip, provider } },
      update: {
        availability: data.availability,
        billingStatus: data.billingStatus,
      },
      create: {
        ip,
        provider,
        availability: data.availability,
        billingStatus: data.billingStatus,
        renewalDate: data.renewalDate,
        city: data.city,
        country: data.country,
        monthlyCost: 12.5,
        currency: "USD",
      },
    });
  }

  const pAvail = await upsertProxy("192.0.2.10", "DocsProxy", {
    availability: ProxyAvailability.AVAILABLE,
    billingStatus: BillingStatus.ACTIVE,
    renewalDate: new Date("2026-12-01"),
    city: "Amsterdam",
    country: "NL",
  });
  const pAssigned1 = await upsertProxy("192.0.2.21", "DocsProxy", {
    availability: ProxyAvailability.ASSIGNED,
    billingStatus: BillingStatus.ACTIVE,
    renewalDate: new Date("2026-06-01"),
    city: "Frankfurt",
    country: "DE",
  });
  const pAssigned2 = await upsertProxy("198.51.100.40", "ExampleNet", {
    availability: ProxyAvailability.ASSIGNED,
    billingStatus: BillingStatus.ACTIVE,
    renewalDate: new Date("2025-01-15"), // overdue indicator demo
    city: "London",
    country: "GB",
  });
  const pPending = await upsertProxy("203.0.113.55", "ExampleNet", {
    availability: ProxyAvailability.AVAILABLE,
    billingStatus: BillingStatus.CANCELLATION_PENDING,
    city: "Paris",
    country: "FR",
  });
  const pRetired = await upsertProxy("203.0.113.90", "OldVendor", {
    availability: ProxyAvailability.RETIRED,
    billingStatus: BillingStatus.CANCELLED,
  });
  const pHist = await upsertProxy("192.0.2.99", "DocsProxy", {
    availability: ProxyAvailability.AVAILABLE,
    billingStatus: BillingStatus.CANCELLED,
  });
  void pAvail;
  void pPending;
  void pRetired;

  async function ensureMachine(
    key: string,
    data: {
      vmid: number;
      serverId: string;
      companyId: string;
      displayName: string;
      lifecycleStatus: LifecycleStatus;
      archivedAt?: Date | null;
      notes?: string;
      internalIp?: string;
      country?: string;
    },
  ) {
    const existing = await prisma.machine.findFirst({
      where: {
        vmid: data.vmid,
        serverId: data.serverId,
        displayName: data.displayName,
      },
    });
    if (existing) return existing;
    return prisma.machine.create({
      data: {
        ...data,
        notes: data.notes ?? `seed:${key}`,
      },
    });
  }

  const mActive = await ensureMachine("active-101", {
    vmid: 101,
    serverId: s1.id,
    companyId: cAlpha.id,
    displayName: "web-alpha",
    lifecycleStatus: LifecycleStatus.ACTIVE,
    internalIp: "192.168.201.10",
    country: "DE",
  });
  const mPrep = await ensureMachine("prep-110", {
    vmid: 110,
    serverId: s1.id,
    companyId: cBeta.id,
    displayName: "staging-beta",
    lifecycleStatus: LifecycleStatus.PREPARING,
    internalIp: "192.168.201.20",
    country: "NL",
  });
  const mExpired = await ensureMachine("expired-220", {
    vmid: 220,
    serverId: s2.id,
    companyId: cGamma.id,
    displayName: "shop-gamma",
    lifecycleStatus: LifecycleStatus.EXPIRED,
    country: "GB",
  });
  const mBurned = await ensureMachine("burned-305", {
    vmid: 305,
    serverId: s2.id,
    companyId: cAlpha.id,
    displayName: "ops-burn",
    lifecycleStatus: LifecycleStatus.BURNED,
  });
  const mArchived = await ensureMachine("archived-401", {
    vmid: 401,
    serverId: s1.id,
    companyId: cBeta.id,
    displayName: "legacy-closed",
    lifecycleStatus: LifecycleStatus.ARCHIVED,
    archivedAt: new Date("2025-11-01T12:00:00Z"),
  });

  async function ensureOpenAssignment(machineId: string, proxyId: string) {
    const open = await prisma.proxyAssignment.findFirst({
      where: { machineId, endedAt: null },
    });
    if (open) return open;
    // end any open on proxy first for idempotency
    await prisma.proxyAssignment.updateMany({
      where: { proxyId, endedAt: null },
      data: { endedAt: new Date() },
    });
    return prisma.proxyAssignment.create({
      data: { machineId, proxyId, reason: "Initial seed assignment" },
    });
  }

  await ensureOpenAssignment(mActive.id, pAssigned1.id);
  await ensureOpenAssignment(mExpired.id, pAssigned2.id);

  // Historical rotation on active machine
  const histCount = await prisma.proxyAssignment.count({
    where: { machineId: mActive.id, proxyId: pHist.id },
  });
  if (histCount === 0) {
    await prisma.proxyAssignment.create({
      data: {
        machineId: mActive.id,
        proxyId: pHist.id,
        startedAt: new Date("2025-06-01T00:00:00Z"),
        endedAt: new Date("2025-09-01T00:00:00Z"),
        reason: "Rotated for geography",
      },
    });
  }

  // Partial wipeout on burned
  const burnedClosure = await prisma.closureChecklist.findUnique({
    where: { machineId: mBurned.id },
  });
  if (!burnedClosure) {
    await prisma.closureChecklist.create({
      data: {
        machineId: mBurned.id,
        reason: ClosureReason.BURNED,
        templateName: template.name,
        items: {
          create: defaultItems.map((label, i) => ({
            label,
            required: true,
            sortOrder: i,
            status:
              i < 2
                ? ChecklistItemStatus.COMPLETED
                : ChecklistItemStatus.PENDING,
            completedAt: i < 2 ? new Date() : null,
          })),
        },
      },
    });
  }

  // Completed archive checklist
  const archClosure = await prisma.closureChecklist.findUnique({
    where: { machineId: mArchived.id },
  });
  if (!archClosure) {
    await prisma.closureChecklist.create({
      data: {
        machineId: mArchived.id,
        reason: ClosureReason.EXPIRED,
        templateName: template.name,
        completedAt: new Date("2025-11-01T12:00:00Z"),
        items: {
          create: defaultItems.map((label, i) => ({
            label,
            required: true,
            sortOrder: i,
            status: ChecklistItemStatus.COMPLETED,
            completedAt: new Date("2025-11-01T12:00:00Z"),
          })),
        },
      },
    });
    await prisma.proxyAssignment.create({
      data: {
        machineId: mArchived.id,
        proxyId: pHist.id,
        startedAt: new Date("2024-01-01T00:00:00Z"),
        endedAt: new Date("2025-11-01T12:00:00Z"),
        reason: "Closure completed",
      },
    });
  }

  // Ensure prep has no assignment; touch unused refs
  void mPrep;
  void pAvail;

  console.log("Seed complete (idempotent).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
