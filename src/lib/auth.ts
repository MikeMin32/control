import { cookies, headers } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { AppError } from "./errors";

const SESSION_COOKIE = "vmcontrol_session";
const SESSION_DAYS = 14;
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return token;
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }
  return session.user;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    throw new AppError("Authentication required", "UNAUTHENTICATED", 401);
  }
  return user;
}

export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin) return; // same-origin navigations / form posts without Origin
  const appUrl = process.env.APP_URL || (host ? `http://${host}` : "");
  try {
    const o = new URL(origin);
    const a = new URL(appUrl);
    if (o.host !== a.host && o.host !== host) {
      throw new AppError("Invalid request origin", "CSRF", 403);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Invalid request origin", "CSRF", 403);
  }
}

export async function recordLoginAttempt(
  ip: string,
  email: string,
  success: boolean,
) {
  await prisma.loginAttempt.create({ data: { ip, email, success } });
}

export async function isLoginThrottled(ip: string, email: string) {
  const since = new Date(Date.now() - WINDOW_MS);
  const fails = await prisma.loginAttempt.count({
    where: {
      success: false,
      createdAt: { gte: since },
      OR: [{ ip }, { email }],
    },
  });
  return fails >= MAX_ATTEMPTS;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export { SESSION_COOKIE, SESSION_DAYS };
