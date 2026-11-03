import { logoutAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import type { ProxmoxStatus } from "@/lib/proxmox";

export function Header({
  email,
  proxmox,
}: {
  email: string;
  proxmox: ProxmoxStatus;
}) {
  const proxmoxLabel =
    proxmox.state === "not_configured"
      ? "Proxmox: Not configured"
      : proxmox.state === "connected"
        ? "Proxmox: Connected"
        : "Proxmox: Unreachable";

  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-5">
      <div className="text-xs text-muted">{proxmoxLabel}</div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink">{email}</span>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Log out
          </Button>
        </form>
      </div>
    </header>
  );
}
