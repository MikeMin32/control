"use client";

import { useState, useTransition } from "react";
import { loginAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-slate border border-line bg-surface p-8 shadow-soft">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            VM Control
          </h1>
          <p className="mt-1 text-sm text-muted">Sign in to continue</p>
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
            <p className="text-sm text-rose-700" role="alert">
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
