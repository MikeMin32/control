"use client";

import { useEffect, useState } from "react";
import { Field, Input } from "@/components/ui/input";
import { suggestedInternalIp } from "@/lib/internal-ip";

export type InternalIpMode = "auto" | "manual";

/**
 * Editable Internal IP with optional auto-suggestion from VMID.
 * - auto: value tracks suggestedInternalIp(vmid); unsupported/cleared VMID → empty
 * - manual: user edits (including clear) are preserved across VMID changes
 */
export function InternalIpField({
  vmid,
  name = "internalIp",
  initialValue = "",
  initialMode = "auto",
  resetKey,
  className,
}: {
  vmid: string | number;
  name?: string;
  initialValue?: string;
  initialMode?: InternalIpMode;
  /** Change to remount/reset (e.g. fresh Add VM dialog). */
  resetKey?: string | number | boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<InternalIpMode>(initialMode);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setMode(initialMode);
    setValue(initialValue);
    // Intentionally keyed by resetKey / identity of the form instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on token only
  }, [resetKey]);

  useEffect(() => {
    if (mode !== "auto") return;
    setValue(suggestedInternalIp(vmid) ?? "");
  }, [vmid, mode]);

  const suggested = suggestedInternalIp(vmid);
  const showRestore =
    Boolean(suggested) && (mode === "manual" || value !== suggested);

  return (
    <Field label="Internal IP" className={className}>
      <Input
        name={name}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          setMode("manual");
          setValue(e.target.value);
        }}
      />
      {showRestore ? (
        <button
          type="button"
          className="mt-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
          onClick={() => {
            if (!suggested) return;
            setValue(suggested);
            setMode("auto");
          }}
        >
          Use suggested IP
        </button>
      ) : null}
    </Field>
  );
}
