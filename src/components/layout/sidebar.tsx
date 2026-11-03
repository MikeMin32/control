"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Eraser,
  Menu,
  Monitor,
  Settings,
  Share2,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/machines", label: "Machines", icon: Monitor },
  { href: "/proxies", label: "Proxies", icon: Share2 },
  { href: "/wipeout", label: "Wipeout", icon: Eraser },
  { href: "/archive", label: "Archive", icon: Archive },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 p-3">
      {NAV.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-slate px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-sidebar-active text-ink"
                : "text-muted hover:bg-sidebar-active/60 hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold tracking-tight">VM Control</span>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/20"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-64 flex-col bg-sidebar">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-sm font-semibold">VM Control</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-sidebar lg:flex">
        <div className="px-5 py-5">
          <div className="text-[15px] font-semibold tracking-tight text-ink">
            VM Control
          </div>
          <div className="mt-0.5 text-xs text-muted">Inventory & lifecycle</div>
        </div>
        {nav}
      </aside>
    </>
  );
}
