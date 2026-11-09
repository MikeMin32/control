/**
 * Inventory Internal IP helpers.
 * Suggested pattern: 192.168.{VMID}.10 when VMID is an integer 1–254.
 * Does not touch Proxmox networking.
 */

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Parse a VMID that can drive automatic Internal IP suggestions. */
export function parseSuggestableVmid(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1 || raw > 254) return null;
    return raw;
  }
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 254) return null;
  return n;
}

/** Suggested Internal IP for a VMID, or null when no automatic suggestion applies. */
export function suggestedInternalIp(vmid: unknown): string | null {
  const n = parseSuggestableVmid(vmid);
  if (n === null) return null;
  return `192.168.${n}.10`;
}

/** Strict IPv4 dotted-quad check (empty string is not valid; callers treat empty as optional). */
export function isValidIpv4(value: string): boolean {
  return IPV4_RE.test(value.trim());
}

/**
 * Normalize optional Internal IP for persistence.
 * Empty → null. Nonempty must be valid IPv4 (any subnet).
 */
export function normalizeOptionalIpv4(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isValidIpv4(trimmed)) {
    throw new Error("INVALID_IPV4");
  }
  return trimmed;
}
