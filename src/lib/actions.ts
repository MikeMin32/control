"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  BillingStatus,
  ChecklistItemStatus,
  ClosureReason,
  LifecycleStatus,
} from "@prisma/client";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  assertSameOrigin,
  createSession,
  destroySession,
  getSessionUser,
  isLoginThrottled,
  recordLoginAttempt,
  requireUser,
  verifyPassword,
} from "./auth";
import { prisma } from "./db";
import { toActionResult } from "./errors";
import * as machines from "./services/machines";
import * as proxies from "./services/proxies";
import * as wipeout from "./services/wipeout";
import * as setup from "./services/setup";
import * as settings from "./services/settings";
import * as dolphin from "./services/dolphin";
import type { CompleteOverrideInput } from "./checklist-override";
import { probeProxmox } from "./proxmox";

function cookieOptions(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  };
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";

  if (await isLoginThrottled(ip, email)) {
    return { ok: false as const, error: "Too many login attempts. Try later." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid =
    user && (await verifyPassword(password, user.passwordHash));
  await recordLoginAttempt(ip, email, Boolean(valid));
  if (!valid || !user) {
    return { ok: false as const, error: "Invalid email or password" };
  }

  const token = await createSession(user.id);
  const jar = await cookies();
  jar.set(cookieOptions(token));
  redirect("/machines");
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await destroySession(token);
  jar.set({
    name: SESSION_COOKIE,
    value: "",
    path: "/",
    expires: new Date(0),
  });
  redirect("/login");
}

export async function createMachineAction(input: {
  vmid: number;
  displayName?: string;
  serverId: string;
  company?: string | null;
  lifecycleStatus?: LifecycleStatus;
  internalIp?: string;
  country?: string | null;
  os?: string;
  notes?: string;
  proxyId?: string | null;
}) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    const machine = await machines.createMachine(input, user.id);
    revalidatePath("/machines");
    return { ok: true as const, id: machine.id };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateMachineAction(
  id: string,
  input: Parameters<typeof machines.updateMachine>[1],
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await machines.updateMachine(id, input, user.id);
    revalidatePath("/machines");
    revalidatePath(`/machines`);
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function migrateMachineAction(
  id: string,
  input: { toServerId: string; toVmid: number; note?: string },
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await machines.migrateMachine(id, input, user.id);
    revalidatePath("/machines");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function createCompanyInlineAction(name: string) {
  try {
    await assertSameOrigin();
    await requireUser();
    const company = await settings.createCompany(name);
    revalidatePath("/settings");
    revalidatePath("/machines");
    return { ok: true as const, id: company.id, name: company.name };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function createProxyAction(
  input: Parameters<typeof proxies.createProxy>[0],
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    const proxy = await proxies.createProxy(input, user.id);
    revalidatePath("/proxies");
    revalidatePath("/dolphin");
    return { ok: true as const, id: proxy.id };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function rotateProxyAction(
  machineId: string,
  input: { proxyId: string; reason: string },
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await proxies.rotateProxy(machineId, input, user.id);
    revalidatePath("/machines");
    revalidatePath("/proxies");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function rotateDolphinConnectionProxyAction(
  dolphinId: string,
  input: { proxyId: string; reason: string },
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await proxies.rotateDolphinConnectionProxy(dolphinId, input, user.id);
    revalidatePath("/proxies");
    revalidatePath("/dolphin");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateProxyBillingAction(
  id: string,
  billingStatus: BillingStatus,
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await proxies.updateProxyBilling(id, billingStatus, user.id);
    revalidatePath("/proxies");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function retireProxyAction(id: string) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await proxies.retireProxy(id, user.id);
    revalidatePath("/proxies");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function markBurnedAction(machineId: string, reasonNote?: string) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await wipeout.markBurnedAndStartClosure(machineId, user.id, reasonNote);
    revalidatePath("/machines");
    revalidatePath("/wipeout");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function startClosureAction(
  machineId: string,
  reason: ClosureReason,
  reasonNote?: string,
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await wipeout.startClosure(machineId, { reason, reasonNote }, user.id);
    revalidatePath("/wipeout");
    revalidatePath("/machines");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateChecklistItemAction(
  itemId: string,
  input: {
    status: ChecklistItemStatus;
    notes?: string;
    naReason?: string;
  },
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await wipeout.updateChecklistItem(itemId, input, user.id);
    revalidatePath("/wipeout");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function addCustomChecklistItemAction(
  checklistId: string,
  label: string,
  required: boolean,
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await wipeout.addCustomChecklistItem(checklistId, label, required, user.id);
    revalidatePath("/wipeout");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function completeClosureAction(
  machineId: string,
  override: CompleteOverrideInput = {},
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await wipeout.completeClosure(machineId, user.id, override);
    revalidatePath("/wipeout");
    revalidatePath("/archive");
    revalidatePath("/machines");
    revalidatePath("/proxies");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function previewMissingWipeoutTasksAction(checklistId: string) {
  try {
    await assertSameOrigin();
    await requireUser();
    const missing = await wipeout.previewMissingWipeoutTasks(checklistId);
    return { ok: true as const, missing };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function addMissingWipeoutTasksAction(
  checklistId: string,
  labels: string[],
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await wipeout.addMissingWipeoutTasks(checklistId, labels, user.id);
    revalidatePath("/wipeout");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function startSetupAction(machineId: string) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await setup.startSetupChecklist(machineId, user.id);
    revalidatePath("/machines");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateSetupItemAction(
  itemId: string,
  input: {
    status: ChecklistItemStatus;
    notes?: string;
    naReason?: string;
  },
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await setup.updateSetupItem(itemId, input, user.id);
    revalidatePath("/machines");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function finishSetupAction(
  machineId: string,
  override: CompleteOverrideInput = {},
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await setup.finishSetup(machineId, user.id, override);
    revalidatePath("/machines");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function createDolphinAction(input: {
  accountName: string;
  machineId?: string | null;
  wallet?: string | null;
  walletAddress?: string | null;
  network?: string | null;
  notes?: string | null;
}) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    const row = await dolphin.createDolphinAccount(input, user.id);
    revalidatePath("/dolphin");
    revalidatePath("/machines");
    return { ok: true as const, id: row.id };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateDolphinAction(
  id: string,
  input: {
    accountName: string;
    machineId?: string | null;
    wallet?: string | null;
    walletAddress?: string | null;
    network?: string | null;
    notes?: string | null;
  },
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await dolphin.updateDolphinAccount(id, input, user.id);
    revalidatePath("/dolphin");
    revalidatePath("/machines");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function deleteDolphinAction(id: string) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await dolphin.deleteDolphinAccount(id, user.id);
    revalidatePath("/dolphin");
    revalidatePath("/machines");
    revalidatePath("/proxies");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function retireDolphinAction(id: string) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await dolphin.retireDolphinAccount(id, user.id);
    revalidatePath("/dolphin");
    revalidatePath("/machines");
    revalidatePath("/proxies");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function createServerAction(name: string, notes?: string) {
  try {
    await assertSameOrigin();
    await requireUser();
    await settings.createServer(name, notes);
    revalidatePath("/settings");
    revalidatePath("/machines");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function retireServerAction(id: string) {
  try {
    await assertSameOrigin();
    await requireUser();
    await settings.retireServer(id);
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function createCompanyAction(name: string, notes?: string) {
  try {
    await assertSameOrigin();
    await requireUser();
    await settings.createCompany(name, notes);
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateTimezoneAction(tz: string) {
  try {
    await assertSameOrigin();
    await requireUser();
    await settings.updateTimezone(tz);
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
) {
  try {
    await assertSameOrigin();
    const user = await requireUser();
    await settings.changePassword(user.id, currentPassword, newPassword);
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function updateTemplateAction(
  templateId: string,
  items: {
    label: string;
    required: boolean;
    sortOrder: number;
    section?: string | null;
    description?: string | null;
  }[],
) {
  try {
    await assertSameOrigin();
    await requireUser();
    await settings.updateTemplateItems(templateId, items);
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function getProxmoxStatusAction() {
  const user = await getSessionUser();
  if (!user) return { ok: false as const, error: "Authentication required" };
  const status = await probeProxmox();
  return { ok: true as const, status };
}
