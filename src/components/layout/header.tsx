import type { ProxmoxStatus } from "@/lib/proxmox";
import { UserMenu } from "./user-menu";

export function Header({
  email,
  proxmox,
}: {
  email: string;
  proxmox: ProxmoxStatus;
}) {
  const proxmoxLabel =
    proxmox.state === "not_configured"
      ? "Proxmox · Not configured"
      : proxmox.state === "connected"
        ? "Proxmox · Connected"
        : "Proxmox · Unreachable";

  const dot =
    proxmox.state === "connected"
      ? "bg-[#2f9e5f]"
      : proxmox.state === "unreachable"
        ? "bg-[#c45c5c]"
        : "bg-[#7a807c]";

  return (
    <header className="flex h-14 items-center justify-end gap-4 border-b border-line bg-surface px-5">
      <div className="inline-flex items-center gap-2 text-xs text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        {proxmoxLabel}
      </div>
      <div className="h-5 w-px bg-line-strong" aria-hidden />
      <UserMenu email={email} />
    </header>
  );
}
