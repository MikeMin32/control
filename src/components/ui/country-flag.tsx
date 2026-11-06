"use client";

import type { ComponentType, SVGProps } from "react";
import * as Flags from "country-flag-icons/react/3x2";
import { countryName } from "@/lib/countries";
import { cn } from "@/lib/utils";

type FlagComponent = ComponentType<SVGProps<SVGSVGElement>>;

const FLAG_MAP = Flags as unknown as Record<string, FlagComponent>;

export function CountryFlag({
  code,
  className,
  showCode = true,
}: {
  code: string | null | undefined;
  className?: string;
  showCode?: boolean;
}) {
  if (!code) {
    return <span className="text-muted">—</span>;
  }
  const upper = code.toUpperCase();
  const name = countryName(upper) ?? upper;
  const Flag = FLAG_MAP[upper];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={name}
    >
      {Flag ? (
        <Flag
          className="h-3.5 w-[21px] shrink-0 rounded-[2px] border border-line object-cover"
          aria-hidden
        />
      ) : null}
      <span className="sr-only">{name}</span>
      {showCode ? (
        <span className="text-xs font-medium uppercase tracking-wide text-ink">
          {upper}
        </span>
      ) : (
        <span className="text-sm text-ink">{name}</span>
      )}
    </span>
  );
}
