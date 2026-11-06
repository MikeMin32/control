import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(
  value: Date | string | null | undefined,
  timeZone = "Europe/Kyiv",
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Calendar dates (renewal) — never shift by timezone conversion. */
export function formatCalendarDate(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Display calendar date as "Mar 15, 2026" without TZ shift. */
export function formatCalendarDateLong(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  const iso = formatCalendarDate(value);
  if (iso === "—") return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function isRenewalOverdue(
  renewalDate: Date | string | null | undefined,
): boolean {
  if (!renewalDate) return false;
  const s =
    typeof renewalDate === "string"
      ? renewalDate.slice(0, 10)
      : formatCalendarDate(renewalDate);
  const today = new Date();
  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  return s < todayStr;
}

/** Prisma Decimal is not RSC-serializable — convert before Client Components. */
export function serializeDecimal(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

export function serializeProxy<T extends { monthlyCost?: unknown }>(proxy: T) {
  // Spread + override is not enough for Next's RSC flight checks in all cases —
  // rebuild a plain object so no Prisma Decimal instance remains on the wire.
  const plain = { ...proxy } as T & { monthlyCost: number | null };
  plain.monthlyCost = serializeDecimal(proxy.monthlyCost);
  return JSON.parse(
    JSON.stringify(plain, (_key, value) => {
      if (
        value != null &&
        typeof value === "object" &&
        typeof (value as { toNumber?: unknown }).toNumber === "function" &&
        typeof (value as { toFixed?: unknown }).toFixed === "function"
      ) {
        return (value as { toNumber: () => number }).toNumber();
      }
      return value;
    }),
  ) as T & { monthlyCost: number | null };
}

export function serializeMachineProxies<
  T extends {
    proxyAssignments?: { proxy: { monthlyCost?: unknown } }[];
  },
>(machine: T): T {
  if (!machine.proxyAssignments) return machine;
  return {
    ...machine,
    proxyAssignments: machine.proxyAssignments.map((a) => ({
      ...a,
      proxy: serializeProxy(a.proxy),
    })),
  };
}
