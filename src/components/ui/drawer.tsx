"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const titleText = typeof title === "string" ? title : "Drawer";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close drawer"
        className="absolute inset-0 bg-ink/20"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        className={cn(
          "relative z-10 flex h-full w-full flex-col border-l border-line bg-surface shadow-soft",
          wide ? "max-w-xl" : "max-w-md",
        )}
      >
        <header className="sticky top-0 z-10 shrink-0 border-b border-line bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-ink">{title}</h2>
              {subtitle ? (
                <div className="mt-0.5 text-sm text-muted">{subtitle}</div>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {headerExtra ? <div className="mt-3">{headerExtra}</div> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer ? (
          <footer className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-surface px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
