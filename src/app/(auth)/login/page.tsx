"use client";

import { useState, useTransition } from "react";
import { loginAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { BrandMark } from "@/components/ui/brand-mark";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-soft">
        <div className="mb-6 flex items-start gap-3">
          <BrandMark />
          <div>
            <h1 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">
              VM Control
            </h1>
            <p className="mt-1 text-sm text-muted">Sign in to continue</p>
          </div>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await loginAction(fd);
              if (res && "ok" in res && !res.ok) {
                setError(res.error);
              }
            });
          }}
        >
          <Field label="Email">
            <Input
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={pending}
            />
          </Field>
          <Field label="Password">
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
            />
          </Field>
          {error ? (
            <p className="text-sm text-[#8a3030]" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={pending}
          >
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
