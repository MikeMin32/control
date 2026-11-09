"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, filterCountries } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { Input } from "./input";

export function CountrySelect({
  name,
  defaultValue,
  value,
  onChange,
  id,
}: {
  name?: string;
  defaultValue?: string | null;
  value?: string | null;
  onChange?: (code: string | null) => void;
  id?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = controlled ? value || "" : internal;

  const options = useMemo(() => filterCountries(query), [query]);
  const selectedLabel = COUNTRIES.find((c) => c.code === selected)?.name;

  function choose(code: string | null) {
    if (!controlled) setInternal(code ?? "");
    onChange?.(code);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative">
      {name ? (
        <input type="hidden" name={name} value={selected} />
      ) : null}
      <button
        type="button"
        id={id}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-slate border border-line-strong bg-surface px-3 text-left text-sm text-ink",
          "hover:bg-sidebar/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          selected
            ? `Country ${selected}${selectedLabel ? ` ${selectedLabel}` : ""}`
            : "Country"
        }
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? "text-ink" : "text-muted"}>
          {selected
            ? `${selected}${selectedLabel ? ` · ${selectedLabel}` : ""}`
            : "\u00A0"}
        </span>
        <span className="text-xs text-muted">▾</span>
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-slate border border-line bg-surface shadow-soft">
          <div className="border-b border-line p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search countries"
            />
          </div>
          <ul
            role="listbox"
            className="max-h-56 overflow-y-auto py-1 text-sm"
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!selected}
                className="block w-full px-3 py-2 text-left text-muted hover:bg-sidebar"
                onClick={() => choose(null)}
              >
                {"\u00A0"}
              </button>
            </li>
            {options.map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === c.code}
                  className={cn(
                    "block w-full px-3 py-2 text-left hover:bg-sidebar",
                    selected === c.code && "bg-sidebar font-medium",
                  )}
                  onClick={() => choose(c.code)}
                >
                  <span className="font-medium tabular-nums">{c.code}</span>
                  <span className="text-muted"> · {c.name}</span>
                </button>
              </li>
            ))}
            {options.length === 0 ? (
              <li className="px-3 py-2 text-muted">No matches</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
