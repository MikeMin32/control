"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ChecklistTemplate, ChecklistTemplateItem, Company, Server } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  changePasswordAction,
  createCompanyAction,
  createServerAction,
  retireServerAction,
  updateTemplateAction,
  updateTimezoneAction,
} from "@/lib/actions";
import type { ProxmoxStatus } from "@/lib/proxmox";

export function SettingsView({
  servers,
  companies,
  template,
  timezone,
  proxmox,
}: {
  servers: Server[];
  companies: Company[];
  template: ChecklistTemplate & { items: ChecklistTemplateItem[] };
  timezone: string;
  proxmox: ProxmoxStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState(
    template.items.map((i) => ({
      label: i.label,
      required: i.required,
      sortOrder: i.sortOrder,
    })),
  );

  const proxmoxLabel =
    proxmox.state === "not_configured"
      ? "Not configured"
      : proxmox.state === "connected"
        ? `Connected (${proxmox.host})`
        : `Unreachable (${proxmox.host})`;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Servers, companies, wipeout template, account, and optional Proxmox.
        </p>
      </div>

      <Section title="Proxmox (read-only)">
        <p className="text-sm">
          Status: <span className="font-medium">{proxmoxLabel}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          Configure via environment variables. Credentials are never shown in
          the UI. Integration is optional and read-only.
        </p>
      </Section>

      <Section title="Display timezone">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await updateTimezoneAction(String(fd.get("tz")));
              if (!res.ok) setError(res.error);
              else {
                setMessage("Timezone updated");
                router.refresh();
              }
            });
          }}
        >
          <Input name="tz" defaultValue={timezone} className="max-w-xs" />
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
        </form>
      </Section>

      <Section title="Servers">
        <ul className="mb-3 space-y-2 text-sm">
          {servers.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-slate border border-line px-3 py-2"
            >
              <span>
                {s.name}
                {s.retiredAt ? (
                  <span className="ml-2 text-xs text-muted">retired</span>
                ) : null}
              </span>
              {!s.retiredAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const res = await retireServerAction(s.id);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    });
                  }}
                >
                  Retire
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await createServerAction(
                String(fd.get("name")),
                String(fd.get("notes") || "") || undefined,
              );
              if (!res.ok) setError(res.error);
              else {
                (e.target as HTMLFormElement).reset();
                router.refresh();
              }
            });
          }}
        >
          <Input name="name" placeholder="Server name" required />
          <Button type="submit" variant="outline" disabled={pending}>
            Add
          </Button>
        </form>
      </Section>

      <Section title="Companies">
        <ul className="mb-3 space-y-2 text-sm">
          {companies.map((c) => (
            <li
              key={c.id}
              className="rounded-slate border border-line px-3 py-2"
            >
              {c.name}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await createCompanyAction(String(fd.get("name")));
              if (!res.ok) setError(res.error);
              else {
                (e.target as HTMLFormElement).reset();
                router.refresh();
              }
            });
          }}
        >
          <Input name="name" placeholder="Company name" required />
          <Button type="submit" variant="outline" disabled={pending}>
            Add
          </Button>
        </form>
      </Section>

      <Section title="Wipeout checklist template">
        <p className="mb-3 text-xs text-muted">
          Edits apply to new closures only. Existing checklists keep their
          snapshot.
        </p>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                value={item.label}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...item, label: e.target.value };
                  setItems(next);
                }}
              />
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...item, required: e.target.checked };
                    setItems(next);
                  }}
                />
                Req
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setItems(items.filter((_, i) => i !== idx))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setItems([
                ...items,
                {
                  label: "New item",
                  required: true,
                  sortOrder: items.length,
                },
              ])
            }
          >
            Add item
          </Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await updateTemplateAction(
                  template.id,
                  items.map((item, i) => ({ ...item, sortOrder: i })),
                );
                if (!res.ok) setError(res.error);
                else {
                  setMessage("Template saved");
                  router.refresh();
                }
              });
            }}
          >
            Save template
          </Button>
        </div>
      </Section>

      <Section title="Change password">
        <form
          className="max-w-sm space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await changePasswordAction(
                String(fd.get("current")),
                String(fd.get("next")),
              );
              if (!res.ok) setError(res.error);
              else {
                setMessage("Password updated");
                (e.target as HTMLFormElement).reset();
              }
            });
          }}
        >
          <Field label="Current password">
            <Input name="current" type="password" required />
          </Field>
          <Field label="New password">
            <Input name="next" type="password" required minLength={10} />
          </Field>
          <Button type="submit" variant="primary" disabled={pending}>
            Update password
          </Button>
        </form>
      </Section>

      {message ? (
        <p className="text-sm text-emerald-700" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
