"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, User } from "lucide-react";
import { logoutAction } from "@/lib/actions";

export function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const short = email.split("@")[0] || email;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-slate px-1.5 py-1 text-sm text-ink hover:bg-sidebar"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-sidebar text-muted">
          <User className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <span className="max-w-[120px] truncate font-medium">{short}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-slate border border-line bg-surface shadow-soft"
        >
          <div className="border-b border-line px-3 py-2 text-xs text-muted">
            {email}
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink hover:bg-sidebar"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
