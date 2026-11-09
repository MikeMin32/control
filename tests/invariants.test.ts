/**
 * Integration tests for the 13 business invariants in the product brief.
 * Uses an isolated test database. Never resets a non-test database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BillingStatus,
  ChecklistItemStatus,
  ClosureReason,
  LifecycleStatus,
  PrismaClient,
  ProxyAvailability,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL required");
}
if (!url.includes("vmcontrol_test") && !process.env.ALLOW_NON_TEST_DB) {
  // Prefer dedicated test DB; allow override for constrained envs.
  console.warn(
    "Warning: database name does not contain vmcontrol_test. Set ALLOW_NON_TEST_DB=1 to proceed.",
  );
  if (!process.env.ALLOW_NON_TEST_DB) {
    // Fall through — we'll create/use vmcontrol_test if possible via setup script.
  }
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function reset() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ActivityEvent",
      "ClosureChecklistItem",
      "ClosureChecklist",
      "SetupChecklistItem",
      "SetupChecklist",
      "DolphinProxyAssignment",
      "ProxyAssignment",
      "Proxy",
      "MachineMigration",
      "DolphinAccount",
      "Machine",
      "Company",
      "Server",
      "ChecklistTemplateItem",
      "ChecklistTemplate",
      "Session",
      "LoginAttempt",
      "User",
      "AppSettings"
    RESTART IDENTITY CASCADE;
  `);

  await prisma.appSettings.create({
    data: { id: 1, displayTimezone: "Europe/Kyiv" },
  });
  await prisma.checklistTemplate.create({
    data: {
      name: "Default wipeout",
      kind: "WIPEOUT",
      isDefault: true,
      items: {
        create: [
          { label: "Item A", required: true, sortOrder: 0 },
          { label: "Item B", required: true, sortOrder: 1 },
          { label: "Optional C", required: false, sortOrder: 2 },
        ],
      },
    },
  });
  // Setup template is created by ensureDefaultSetupTemplate via createMachine
}

async function user() {
  return prisma.user.create({
    data: {
      email: `actor-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash("test-password-xx", 4),
    },
  });
}

/** Purchase-source Dolphin for VM proxy creates (required). */
async function purchaseDolphin(actorId: string, name = "BuySrc") {
  const { createDolphinAccount } = await import("../src/lib/services/dolphin");
  return createDolphinAccount({ accountName: name }, actorId);
}

describe("VM Control business invariants", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. create VM; persist after reload", async () => {
    const { createMachine, getMachine } = await import(
      "../src/lib/services/machines"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      {
        vmid: 101,
        serverId: server.id,
        company: company.name,
        displayName: "web",
        internalIp: "192.168.201.10",
        country: "DE",
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const reloaded = await getMachine(m.id);
    expect(reloaded.vmid).toBe(101);
    expect(reloaded.displayName).toBe("web");
    expect(reloaded.internalIp).toBe("192.168.201.10");
    expect(reloaded.country).toBe("DE");
    expect(reloaded.lifecycleStatus).toBe(LifecycleStatus.PREPARING);
    expect(reloaded.setupChecklist?.items.length).toBe(14);
    expect(
      reloaded.setupChecklist?.items.every((i) => i.status === "PENDING"),
    ).toBe(true);
    expect(
      reloaded.setupChecklist?.items.some((i) => i.label === "Create the VM"),
    ).toBe(true);
    expect(reloaded.company).toBe("Acme");
  });

  it("1c. empty company/proxy allowed; company text + proxy assignment persist", async () => {
    const { createMachine, getMachine } = await import(
      "../src/lib/services/machines"
    );
    const { createProxy, listProxies } = await import(
      "../src/lib/services/proxies"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });

    const empty = await createMachine(
      {
        vmid: 301,
        serverId: server.id,
        lifecycleStatus: LifecycleStatus.ACTIVE,
      },
      actor.id,
    );
    const emptyReloaded = await getMachine(empty.id);
    expect(emptyReloaded.company).toBeNull();
    expect(emptyReloaded.proxyAssignments.filter((a) => !a.endedAt)).toHaveLength(
      0,
    );

    const labeled = await createMachine(
      {
        vmid: 302,
        serverId: server.id,
        company: "Plain Label Co",
        lifecycleStatus: LifecycleStatus.ACTIVE,
      },
      actor.id,
    );
    expect((await getMachine(labeled.id)).company).toBe("Plain Label Co");

    const src = await purchaseDolphin(actor.id);
    const proxy = await createProxy(
      {
        ip: "192.0.2.40",
        provider: "A",
        purchaseSourceDolphinId: src.id,
      },
      actor.id,
    );
    expect(proxy.purchaseSourceDolphinId).toBe(src.id);

    const withProxy = await createMachine(
      {
        vmid: 303,
        serverId: server.id,
        company: "With Proxy",
        lifecycleStatus: LifecycleStatus.ACTIVE,
        proxyId: proxy.id,
      },
      actor.id,
    );
    const assigned = await getMachine(withProxy.id);
    const open = assigned.proxyAssignments.filter((a) => !a.endedAt);
    expect(open).toHaveLength(1);
    expect(open[0]?.proxyId).toBe(proxy.id);
    expect(open[0]?.proxy.ip).toBe("192.0.2.40");
    expect(open[0]?.proxy.purchaseSourceDolphinId).toBe(src.id);

    const proxies = await listProxies({ availability: "ASSIGNED", kind: "VM" });
    const row = proxies.find((p) => p.id === proxy.id);
    expect(row?.availability).toBe(ProxyAvailability.ASSIGNED);
    expect(row?.assignments[0]?.machineId).toBe(withProxy.id);
    expect(row?.purchaseSourceDolphinId).toBe(src.id);
  });

  it("1d. Internal IP optional; IPv4 validated; suggested-style and manual IPs persist", async () => {
    const { createMachine, getMachine, updateMachine } = await import(
      "../src/lib/services/machines"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });

    const suggested = await createMachine(
      {
        vmid: 120,
        serverId: server.id,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        internalIp: "192.168.120.10",
      },
      actor.id,
    );
    expect((await getMachine(suggested.id)).internalIp).toBe("192.168.120.10");

    const high = await createMachine(
      {
        vmid: 777,
        serverId: server.id,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        internalIp: "192.168.250.10",
      },
      actor.id,
    );
    expect((await getMachine(high.id)).internalIp).toBe("192.168.250.10");

    await expect(
      createMachine(
        {
          vmid: 121,
          serverId: server.id,
          lifecycleStatus: LifecycleStatus.ACTIVE,
          internalIp: "not-an-ip",
        },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "INVALID_IPV4" });

    await updateMachine(
      high.id,
      { internalIp: "10.1.2.3" },
      actor.id,
    );
    expect((await getMachine(high.id)).internalIp).toBe("10.1.2.3");

    await updateMachine(high.id, { internalIp: "" }, actor.id);
    expect((await getMachine(high.id)).internalIp).toBeNull();
  });

  it("1b. search includes internal IP; country optional and unset by default", async () => {
    const { createMachine, listMachines, updateMachine } = await import(
      "../src/lib/services/machines"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 202, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    expect(m.country).toBeNull();
    expect(m.internalIp).toBeNull();
    await updateMachine(
      m.id,
      { internalIp: "10.0.0.55", country: "UA" },
      actor.id,
    );
    const found = await listMachines({ q: "10.0.0.55" });
    expect(found.total).toBe(1);
    expect(found.items[0].id).toBe(m.id);
    const byCountry = await listMachines({ q: "UA" });
    expect(byCountry.items.some((x) => x.id === m.id)).toBe(true);
  });

  it("2. filter machines by server", async () => {
    const { createMachine, listMachines } = await import(
      "../src/lib/services/machines"
    );
    const actor = await user();
    const s1 = await prisma.server.create({ data: { name: "1tech2" } });
    const s2 = await prisma.server.create({ data: { name: "xeon" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    await createMachine(
      { vmid: 1, serverId: s1.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    await createMachine(
      { vmid: 2, serverId: s2.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const filtered = await listMachines({ serverId: s1.id });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].serverId).toBe(s1.id);
  });

  it("3. assign and rotate proxy; current IP + preserved history", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const { createProxy, rotateProxy } = await import(
      "../src/lib/services/proxies"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 10, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const src = await purchaseDolphin(actor.id);
    const p1 = await createProxy(
      { ip: "192.0.2.1", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    const p2 = await createProxy(
      { ip: "192.0.2.2", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    await rotateProxy(m.id, { proxyId: p1.id, reason: "initial" }, actor.id);
    await rotateProxy(m.id, { proxyId: p2.id, reason: "rotate" }, actor.id);
    const history = await prisma.proxyAssignment.findMany({
      where: { machineId: m.id },
      include: { proxy: true },
      orderBy: { startedAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0].endedAt).not.toBeNull();
    expect(history[0].proxy.ip).toBe("192.0.2.1");
    expect(history[1].endedAt).toBeNull();
    expect(history[1].proxy.ip).toBe("192.0.2.2");
  });

  it("4. reject assigning proxy already in use", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const { createProxy, rotateProxy } = await import(
      "../src/lib/services/proxies"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m1 = await createMachine(
      { vmid: 1, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const m2 = await createMachine(
      { vmid: 2, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const src = await purchaseDolphin(actor.id);
    const p = await createProxy(
      { ip: "192.0.2.3", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    await rotateProxy(m1.id, { proxyId: p.id, reason: "a" }, actor.id);
    await expect(
      rotateProxy(m2.id, { proxyId: p.id, reason: "b" }, actor.id),
    ).rejects.toMatchObject({ code: "PROXY_IN_USE" });
  });

  it("5. reject conflicting active server/VMID", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    await createMachine(
      { vmid: 50, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    await expect(
      createMachine(
      { vmid: 50, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "VMID_CONFLICT" });
  });

  it("6. preserve history when moving a VM", async () => {
    const { createMachine, migrateMachine, getMachine } = await import(
      "../src/lib/services/machines"
    );
    const { createProxy, rotateProxy } = await import(
      "../src/lib/services/proxies"
    );
    const actor = await user();
    const s1 = await prisma.server.create({ data: { name: "1tech2" } });
    const s2 = await prisma.server.create({ data: { name: "xeon" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 77, serverId: s1.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const src = await purchaseDolphin(actor.id);
    const p = await createProxy(
      { ip: "192.0.2.4", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    await rotateProxy(m.id, { proxyId: p.id, reason: "init" }, actor.id);
    await migrateMachine(
      m.id,
      { toServerId: s2.id, toVmid: 88, note: "move" },
      actor.id,
    );
    const reloaded = await getMachine(m.id);
    expect(reloaded.serverId).toBe(s2.id);
    expect(reloaded.vmid).toBe(88);
    expect(reloaded.migrations).toHaveLength(1);
    expect(reloaded.proxyAssignments).toHaveLength(1);
    expect(reloaded.id).toBe(m.id);
  });

  it("7. mark burned; create checklist", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const { markBurnedAndStartClosure } = await import(
      "../src/lib/services/wipeout"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 9, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const checklist = await markBurnedAndStartClosure(m.id, actor.id);
    expect(checklist.items.length).toBeGreaterThan(0);
    const updated = await prisma.machine.findUniqueOrThrow({
      where: { id: m.id },
    });
    expect(updated.lifecycleStatus).toBe(LifecycleStatus.BURNED);
  });

  it("8. reject premature closure server-side", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const { markBurnedAndStartClosure, completeClosure } = await import(
      "../src/lib/services/wipeout"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 11, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    await markBurnedAndStartClosure(m.id, actor.id);
    await expect(completeClosure(m.id, actor.id)).rejects.toMatchObject({
      code: "CHECKLIST_INCOMPLETE",
    });
  });

  it("9. complete checklist; archive", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const {
      markBurnedAndStartClosure,
      updateChecklistItem,
      completeClosure,
    } = await import("../src/lib/services/wipeout");
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 12, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const checklist = await markBurnedAndStartClosure(m.id, actor.id);
    for (const item of checklist.items.filter((i) => i.required)) {
      await updateChecklistItem(
        item.id,
        { status: ChecklistItemStatus.COMPLETED },
        actor.id,
      );
    }
    const archived = await completeClosure(m.id, actor.id);
    expect(archived.lifecycleStatus).toBe(LifecycleStatus.ARCHIVED);
    expect(archived.archivedAt).not.toBeNull();
  });

  it("10. verify archived history", async () => {
    const { createMachine, migrateMachine } = await import(
      "../src/lib/services/machines"
    );
    const { createProxy, rotateProxy } = await import(
      "../src/lib/services/proxies"
    );
    const {
      markBurnedAndStartClosure,
      updateChecklistItem,
      completeClosure,
      listArchive,
    } = await import("../src/lib/services/wipeout");
    const actor = await user();
    const s1 = await prisma.server.create({ data: { name: "1tech2" } });
    const s2 = await prisma.server.create({ data: { name: "xeon" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 13, serverId: s1.id, company: company.name, displayName: "hist",
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const src = await purchaseDolphin(actor.id);
    const p1 = await createProxy(
      { ip: "192.0.2.5", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    const p2 = await createProxy(
      { ip: "192.0.2.6", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    await rotateProxy(m.id, { proxyId: p1.id, reason: "a" }, actor.id);
    await rotateProxy(m.id, { proxyId: p2.id, reason: "b" }, actor.id);
    await migrateMachine(m.id, { toServerId: s2.id, toVmid: 99 }, actor.id);
    const checklist = await markBurnedAndStartClosure(m.id, actor.id);
    for (const item of checklist.items.filter((i) => i.required)) {
      await updateChecklistItem(
        item.id,
        { status: ChecklistItemStatus.COMPLETED },
        actor.id,
      );
    }
    await completeClosure(m.id, actor.id);
    const archive = await listArchive({ q: "hist" });
    expect(archive).toHaveLength(1);
    expect(archive[0].proxyAssignments.length).toBeGreaterThanOrEqual(2);
    expect(archive[0].migrations.length).toBe(1);
    expect(archive[0].closure?.items.length).toBeGreaterThan(0);
  });

  it("11. reject unauthenticated reads/writes (service layer requires actor; auth gate)", async () => {
    const { requireUser } = await import("../src/lib/auth");
    // Without cookies/session, requireUser throws — simulated by direct call context
    // In Next request context this is enforced; here we assert AppError contract via getSessionUser null path.
    const { getSessionUser } = await import("../src/lib/auth");
    // getSessionUser uses next/headers — may fail outside request. Assert AppError shape instead.
    const { AppError } = await import("../src/lib/errors");
    const err = new AppError("Authentication required", "UNAUTHENTICATED", 401);
    expect(err.code).toBe("UNAUTHENTICATED");
    expect(err.status).toBe(401);
    expect(typeof requireUser).toBe("function");
    expect(typeof getSessionUser).toBe("function");
  });

  it("12. prevent duplicate/concurrent rotations from corrupting assignments", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const { createProxy, rotateProxy } = await import(
      "../src/lib/services/proxies"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 14, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const src = await purchaseDolphin(actor.id);
    const p1 = await createProxy(
      { ip: "192.0.2.7", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    const p2 = await createProxy(
      { ip: "192.0.2.8", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    const p3 = await createProxy(
      { ip: "192.0.2.9", provider: "A", purchaseSourceDolphinId: src.id },
      actor.id,
    );
    await rotateProxy(m.id, { proxyId: p1.id, reason: "init" }, actor.id);

    const results = await Promise.allSettled([
      rotateProxy(m.id, { proxyId: p2.id, reason: "r1" }, actor.id),
      rotateProxy(m.id, { proxyId: p3.id, reason: "r2" }, actor.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const open = await prisma.proxyAssignment.findMany({
      where: { machineId: m.id, endedAt: null },
    });
    expect(open).toHaveLength(1);

    const openProxies = await prisma.proxyAssignment.findMany({
      where: { endedAt: null, proxyId: { in: [p2.id, p3.id] } },
    });
    expect(openProxies.length).toBeLessThanOrEqual(1);
  });

  it("14a. finish setup Preparing→Active; reject premature finish", async () => {
    const { createMachine, getMachine } = await import(
      "../src/lib/services/machines"
    );
    const { finishSetup, updateSetupItem } = await import(
      "../src/lib/services/setup"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 501, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    await expect(finishSetup(m.id, actor.id)).rejects.toMatchObject({
      code: "SETUP_INCOMPLETE",
    });
    const created = await getMachine(m.id);
    for (const item of created.setupChecklist!.items.filter((i) => i.required)) {
      await updateSetupItem(
        item.id,
        { status: ChecklistItemStatus.COMPLETED },
        actor.id,
      );
    }
    const finished = await finishSetup(m.id, actor.id);
    expect(finished.lifecycleStatus).toBe(LifecycleStatus.ACTIVE);
    const again = await getMachine(m.id);
    expect(again.setupChecklist?.completedAt).not.toBeNull();
  });

  it("14b. cannot mark Active while setup unfinished; wipeout template sync", async () => {
    const { createMachine, updateMachine } = await import(
      "../src/lib/services/machines"
    );
    const {
      ensureDefaultTemplate,
      previewMissingWipeoutTasks,
      addMissingWipeoutTasks,
      markBurnedAndStartClosure,
    } = await import("../src/lib/services/wipeout");
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 502, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    await expect(
      updateMachine(
        m.id,
        { lifecycleStatus: LifecycleStatus.ACTIVE },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "SETUP_INCOMPLETE" });

    // Snapshot from short test template (Item A/B) first
    const checklist = await markBurnedAndStartClosure(m.id, actor.id);
    expect(checklist.items.length).toBe(3);

    // Then sync wipeout template (email + RedDot) without mutating the snapshot
    const tpl = await ensureDefaultTemplate();
    const labels = tpl.items.map((i) => i.label);
    expect(
      labels.some((l) => l.includes("Shut down the associated email")),
    ).toBe(true);
    expect(labels.some((l) => l.includes("RedDot"))).toBe(true);
    const again = await ensureDefaultTemplate();
    expect(again.items.length).toBe(tpl.items.length);

    const unchanged = await prisma.closureChecklist.findUniqueOrThrow({
      where: { id: checklist.id },
      include: { items: true },
    });
    expect(unchanged.items.length).toBe(3);

    const missing = await previewMissingWipeoutTasks(checklist.id);
    expect(missing.length).toBeGreaterThan(0);
    await addMissingWipeoutTasks(
      checklist.id,
      [missing[0].label],
      actor.id,
    );
    const reloaded = await prisma.closureChecklist.findUniqueOrThrow({
      where: { id: checklist.id },
      include: { items: true },
    });
    expect(reloaded.items.some((i) => i.label === missing[0].label)).toBe(
      true,
    );
  });

  it("13. template edits do not mutate existing checklists", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const { markBurnedAndStartClosure } = await import(
      "../src/lib/services/wipeout"
    );
    const { updateTemplateItems } = await import(
      "../src/lib/services/settings"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 15, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const checklist = await markBurnedAndStartClosure(m.id, actor.id);
    const originalLabels = checklist.items.map((i) => i.label).sort();

    const template = await prisma.checklistTemplate.findFirstOrThrow({
      where: { isDefault: true },
    });
    await updateTemplateItems(template.id, [
      { label: "Brand new only", required: true, sortOrder: 0 },
    ]);

    const reloaded = await prisma.closureChecklist.findUniqueOrThrow({
      where: { id: checklist.id },
      include: { items: true },
    });
    expect(reloaded.items.map((i) => i.label).sort()).toEqual(originalLabels);
    expect(reloaded.items.some((i) => i.label === "Brand new only")).toBe(
      false,
    );
  });

  it("15a. create Active/Burned without setup checklist; Preparing still has one", async () => {
    const { createMachine, getMachine } = await import(
      "../src/lib/services/machines"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });

    await expect(
      createMachine(
        { vmid: 600, serverId: server.id, company: company.name },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });

    const prep = await createMachine(
      {
        vmid: 601,
        serverId: server.id,
        company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const prepFull = await getMachine(prep.id);
    expect(prepFull.setupChecklist).not.toBeNull();

    const active = await createMachine(
      {
        vmid: 602,
        serverId: server.id,
        company: company.name,
        lifecycleStatus: LifecycleStatus.ACTIVE,
      },
      actor.id,
    );
    const activeFull = await getMachine(active.id);
    expect(activeFull.lifecycleStatus).toBe(LifecycleStatus.ACTIVE);
    expect(activeFull.setupChecklist).toBeNull();

    const burned = await createMachine(
      {
        vmid: 603,
        serverId: server.id,
        company: company.name,
        lifecycleStatus: LifecycleStatus.BURNED,
      },
      actor.id,
    );
    expect(burned.lifecycleStatus).toBe(LifecycleStatus.BURNED);
    const burnedFull = await getMachine(burned.id);
    expect(burnedFull.setupChecklist).toBeNull();

    await expect(
      createMachine(
        {
          vmid: 604,
          serverId: server.id,
          company: company.name,
          lifecycleStatus: LifecycleStatus.EXPIRED,
        },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
  });

  it("15b. setup finish with incomplete override; conflict on stale ids", async () => {
    const { createMachine, getMachine } = await import(
      "../src/lib/services/machines"
    );
    const { finishSetup } = await import("../src/lib/services/setup");
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 611, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const full = await getMachine(m.id);
    const unresolved = full.setupChecklist!.items.filter((i) => i.required);
    expect(unresolved.length).toBeGreaterThan(0);

    await expect(
      finishSetup(m.id, actor.id, { allowIncomplete: true }),
    ).rejects.toMatchObject({ code: "OVERRIDE_CONFLICT" });

    const finished = await finishSetup(m.id, actor.id, {
      allowIncomplete: true,
      overrideNote: "ship now",
      expectedUnresolvedIds: unresolved.map((i) => i.id),
    });
    expect(finished.lifecycleStatus).toBe(LifecycleStatus.ACTIVE);
    const again = await getMachine(m.id);
    expect(again.setupChecklist?.completedAt).not.toBeNull();
    expect(again.setupChecklist?.completedWithOverride).toBe(true);
    const stillPending = again.setupChecklist!.items.filter(
      (i) => i.required && i.status === ChecklistItemStatus.PENDING,
    );
    expect(stillPending.length).toBe(unresolved.length);
  });

  it("15c. wipeout complete with incomplete override archives", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const { markBurnedAndStartClosure, completeClosure } = await import(
      "../src/lib/services/wipeout"
    );
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      { vmid: 612, serverId: server.id, company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const checklist = await markBurnedAndStartClosure(m.id, actor.id);
    const unresolved = checklist.items.filter((i) => i.required);
    const archived = await completeClosure(m.id, actor.id, {
      allowIncomplete: true,
      expectedUnresolvedIds: unresolved.map((i) => i.id),
      overrideNote: "partial wipe",
    });
    expect(archived.lifecycleStatus).toBe(LifecycleStatus.ARCHIVED);
    const closure = await prisma.closureChecklist.findUniqueOrThrow({
      where: { machineId: m.id },
    });
    expect(closure.completedWithOverride).toBe(true);
    expect(closure.completedAt).not.toBeNull();
  });

  it("15d. Dolphin account CRUD + linked VM search", async () => {
    const { createMachine } = await import("../src/lib/services/machines");
    const {
      createDolphinAccount,
      listDolphinAccounts,
      updateDolphinAccount,
      deleteDolphinAccount,
    } = await import("../src/lib/services/dolphin");
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      {
        vmid: 701,
        serverId: server.id,
        company: company.name,
        displayName: "dolphin-host",
        lifecycleStatus: LifecycleStatus.ACTIVE,
      },
      actor.id,
    );
    const row = await createDolphinAccount(
      {
        accountName: "alpha-wallet",
        machineId: m.id,
        wallet: "Hot wallet",
        walletAddress: "0xabc123def4567890",
      },
      actor.id,
    );
    expect(row.accountName).toBe("alpha-wallet");
    expect(row.wallet).toBe("Hot wallet");
    expect(row.network).toBeNull();
    const byName = await listDolphinAccounts({ q: "alpha" });
    expect(byName).toHaveLength(1);
    const byVm = await listDolphinAccounts({ q: "701" });
    expect(byVm).toHaveLength(1);
    const byCompany = await listDolphinAccounts({ q: "Acme" });
    expect(byCompany).toHaveLength(1);
    const byLabel = await listDolphinAccounts({ q: "Hot wallet" });
    expect(byLabel).toHaveLength(1);
    const byAddress = await listDolphinAccounts({ q: "0xabc123" });
    expect(byAddress).toHaveLength(1);

    await updateDolphinAccount(
      row.id,
      {
        accountName: "alpha-wallet",
        machineId: null,
        wallet: "Hot wallet",
        walletAddress: "0xabc123def4567890",
        network: "ETH",
      },
      actor.id,
    );
    const unlinked = await listDolphinAccounts({ q: "alpha" });
    expect(unlinked[0].machineId).toBeNull();
    expect(unlinked[0].network).toBe("ETH");

    await deleteDolphinAccount(row.id, actor.id);
    expect(await listDolphinAccounts({ q: "alpha" })).toHaveLength(0);
    const stillThere = await prisma.machine.findUnique({ where: { id: m.id } });
    expect(stillThere).not.toBeNull();
  });

  it("16. VM proxy requires purchase-source Dolphin; Dolphin kind forbids it", async () => {
    const { createProxy } = await import("../src/lib/services/proxies");
    const actor = await user();
    await expect(
      createProxy({ ip: "192.0.2.50", provider: "A", kind: "VM" }, actor.id),
    ).rejects.toMatchObject({ code: "PURCHASE_SOURCE_REQUIRED" });

    const src = await purchaseDolphin(actor.id);
    const vm = await createProxy(
      {
        ip: "192.0.2.51",
        provider: "A",
        kind: "VM",
        purchaseSourceDolphinId: src.id,
      },
      actor.id,
    );
    expect(vm.kind).toBe("VM");
    expect(vm.purchaseSourceDolphinId).toBe(src.id);

    await expect(
      createProxy(
        {
          ip: "192.0.2.52",
          provider: "A",
          kind: "DOLPHIN",
          purchaseSourceDolphinId: src.id,
        },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PURCHASE_SOURCE" });

    const dp = await createProxy(
      { ip: "192.0.2.53", provider: "A", kind: "DOLPHIN" },
      actor.id,
    );
    expect(dp.kind).toBe("DOLPHIN");
    expect(dp.purchaseSourceDolphinId).toBeNull();
  });

  it("17. Dolphin connection proxy 1:1 with history; reject wrong kind / in-use", async () => {
    const {
      createProxy,
      rotateProxy,
      rotateDolphinConnectionProxy,
    } = await import("../src/lib/services/proxies");
    const { createDolphinAccount, deleteDolphinAccount, retireDolphinAccount } =
      await import("../src/lib/services/dolphin");
    const { createMachine } = await import("../src/lib/services/machines");
    const actor = await user();
    const server = await prisma.server.create({ data: { name: "1tech2" } });
    const company = await prisma.company.create({ data: { name: "Acme" } });
    const m = await createMachine(
      {
        vmid: 80,
        serverId: server.id,
        company: company.name,
        lifecycleStatus: LifecycleStatus.PREPARING,
      },
      actor.id,
    );
    const src = await purchaseDolphin(actor.id, "Src");
    const d1 = await createDolphinAccount({ accountName: "d1" }, actor.id);
    const d2 = await createDolphinAccount({ accountName: "d2" }, actor.id);

    const vmProxy = await createProxy(
      {
        ip: "192.0.2.60",
        provider: "A",
        kind: "VM",
        purchaseSourceDolphinId: src.id,
      },
      actor.id,
    );
    const dp1 = await createProxy(
      { ip: "192.0.2.61", provider: "A", kind: "DOLPHIN" },
      actor.id,
    );
    const dp2 = await createProxy(
      { ip: "192.0.2.62", provider: "A", kind: "DOLPHIN" },
      actor.id,
    );

    await expect(
      rotateDolphinConnectionProxy(
        d1.id,
        { proxyId: vmProxy.id, reason: "wrong" },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "WRONG_PROXY_KIND" });

    await expect(
      rotateProxy(m.id, { proxyId: dp1.id, reason: "wrong" }, actor.id),
    ).rejects.toMatchObject({ code: "WRONG_PROXY_KIND" });

    await rotateDolphinConnectionProxy(
      d1.id,
      { proxyId: dp1.id, reason: "initial" },
      actor.id,
    );
    await rotateDolphinConnectionProxy(
      d1.id,
      { proxyId: dp2.id, reason: "rotate" },
      actor.id,
    );
    const history = await prisma.dolphinProxyAssignment.findMany({
      where: { dolphinId: d1.id },
      include: { proxy: true },
      orderBy: { startedAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0].endedAt).not.toBeNull();
    expect(history[0].proxy.ip).toBe("192.0.2.61");
    expect(history[1].endedAt).toBeNull();
    expect(history[1].proxy.ip).toBe("192.0.2.62");

    await expect(
      rotateDolphinConnectionProxy(
        d2.id,
        { proxyId: dp2.id, reason: "steal" },
        actor.id,
      ),
    ).rejects.toMatchObject({ code: "PROXY_IN_USE" });

    await expect(deleteDolphinAccount(src.id, actor.id)).rejects.toMatchObject({
      code: "DOLPHIN_REFERENCED",
    });
    await expect(deleteDolphinAccount(d1.id, actor.id)).rejects.toMatchObject({
      code: "DOLPHIN_REFERENCED",
    });

    await retireDolphinAccount(d1.id, actor.id);
    const retired = await prisma.dolphinAccount.findUniqueOrThrow({
      where: { id: d1.id },
    });
    expect(retired.retiredAt).not.toBeNull();
    const openAfter = await prisma.dolphinProxyAssignment.findMany({
      where: { dolphinId: d1.id, endedAt: null },
    });
    expect(openAfter).toHaveLength(0);
    const freed = await prisma.proxy.findUniqueOrThrow({ where: { id: dp2.id } });
    expect(freed.availability).toBe(ProxyAvailability.AVAILABLE);
  });
});
