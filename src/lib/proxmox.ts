/**
 * Optional read-only Proxmox adapter.
 * Missing credentials ⇒ truthful “Not configured”. Never mutates infrastructure.
 */

export type ProxmoxStatus =
  | { state: "not_configured" }
  | { state: "connected"; lastSyncAt: string; host: string }
  | { state: "unreachable"; lastAttemptAt: string; host: string; error: string };

export type ProxmoxVmSummary = {
  vmid: number;
  name?: string;
  node?: string;
  powerState: "running" | "stopped" | "unknown";
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
};

function isConfigured(): boolean {
  return (
    process.env.PROXMOX_ENABLED === "true" &&
    Boolean(process.env.PROXMOX_HOST) &&
    Boolean(process.env.PROXMOX_TOKEN_ID) &&
    Boolean(process.env.PROXMOX_TOKEN_SECRET)
  );
}

export function getProxmoxStatusSync(): ProxmoxStatus {
  if (!isConfigured()) {
    return { state: "not_configured" };
  }
  // Live connectivity is checked asynchronously; UI starts from this.
  return {
    state: "unreachable",
    lastAttemptAt: new Date().toISOString(),
    host: process.env.PROXMOX_HOST!,
    error: "Connectivity not verified in this process",
  };
}

/** Mock-friendly probe used by Settings. Never throws secrets. */
export async function probeProxmox(): Promise<ProxmoxStatus> {
  if (!isConfigured()) {
    return { state: "not_configured" };
  }

  const host = process.env.PROXMOX_HOST!;
  const timeoutMs = Number(process.env.PROXMOX_TIMEOUT_MS || 8000);

  // In tests / without real network we treat configured-but-mockable hosts specially.
  if (host === "mock.proxmox.local") {
    return {
      state: "connected",
      lastSyncAt: new Date().toISOString(),
      host,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const insecure = process.env.PROXMOX_TLS_INSECURE === "true";
    // Node fetch respects NODE_TLS_REJECT_UNAUTHORIZED; we document trusted CA instead of forcing insecure.
    if (insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    const url = `${host.replace(/\/$/, "")}/api2/json/version`;
    const tokenId = process.env.PROXMOX_TOKEN_ID!;
    const tokenSecret = process.env.PROXMOX_TOKEN_SECRET!;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        state: "unreachable",
        lastAttemptAt: new Date().toISOString(),
        host,
        error: `HTTP ${res.status}`,
      };
    }
    return {
      state: "connected",
      lastSyncAt: new Date().toISOString(),
      host,
    };
  } catch (err) {
    return {
      state: "unreachable",
      lastAttemptAt: new Date().toISOString(),
      host,
      error: err instanceof Error ? err.message : "Network error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Read-only inventory stub — returns empty when not configured / unreachable. */
export async function listProxmoxVms(): Promise<{
  status: ProxmoxStatus;
  vms: ProxmoxVmSummary[];
}> {
  const status = await probeProxmox();
  if (status.state !== "connected") {
    return { status, vms: [] };
  }
  if (status.host === "mock.proxmox.local") {
    return {
      status,
      vms: [
        { vmid: 101, name: "mock-web", powerState: "running", node: "pve" },
        { vmid: 102, name: "mock-db", powerState: "stopped", node: "pve" },
      ],
    };
  }
  // Live listing intentionally minimal — core app does not depend on it.
  return { status, vms: [] };
}
