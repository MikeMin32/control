"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ChecklistTemplate,
  ChecklistTemplateItem,
  Company,
  Server,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import {
  changePasswordAction,
  createCompanyAction,
  createServerAction,
  retireServerAction,
  updateTemplateAction,
  updateTimezoneAction,
} from "@/lib/actions";
import { SETUP_SECTIONS } from "@/lib/checklist-defaults";
import type { ProxmoxStatus } from "@/lib/proxmox";

type TemplateItemDraft = {
  label: string;
  required: boolean;
  sortOrder: number;
  section?: string | null;
  description?: string | null;
};

export function SettingsView({
  servers,
  companies,
  template,
  setupTemplate,
  timezone,
  proxmox,
}: {
  servers: Server[];
  companies: Company[];
  template: ChecklistTemplate & { items: ChecklistTemplateItem[] };
  setupTemplate: ChecklistTemplate & { items: ChecklistTemplateItem[] };
  timezone: string;
  proxmox: ProxmoxStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TemplateItemDraft[]>(
    template.items.map((i) => ({
      label: i.label,
      required: i.required,
      sortOrder: i.sortOrder,
      description: i.description,
    })),
  );
  const [setupItems, setSetupItems] = useState<TemplateItemDraft[]>(
    setupTemplate.items.map((i) => ({
      label: i.label,
      required: i.required,
      sortOrder: i.sortOrder,
      section: i.section,
      description: i.description,
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
          Servers, companies, checklist templates, account, and optional
          Proxmox.
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
          snapshot. Open wipeouts can add missing tasks explicitly.
        </p>
        <TemplateItemsEditor
          items={items}
          setItems={setItems}
          showSection={false}
          showDescription
        />
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
                  description: "",
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
                  setMessage("Wipeout template saved");
                  router.refresh();
                }
              });
            }}
          >
            Save wipeout template
          </Button>
        </div>
      </Section>

      <Section title="VM setup checklist template">
        <p className="mb-3 text-xs text-muted">
          Separate from wipeout. Sections: VM, Domain, PurelyMail. Edits apply
          to new setup checklists only.
        </p>
        <TemplateItemsEditor
          items={setupItems}
          setItems={setSetupItems}
          showSection
          showDescription
        />
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setSetupItems([
                ...setupItems,
                {
                  label: "New item",
                  required: true,
                  sortOrder: setupItems.length,
                  section: "VM",
                  description: "",
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
                  setupTemplate.id,
                  setupItems.map((item, i) => ({ ...item, sortOrder: i })),
                );
                if (!res.ok) setError(res.error);
                else {
                  setMessage("Setup template saved");
                  router.refresh();
                }
              });
            }}
          >
            Save setup template
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

function TemplateItemsEditor({
  items,
  setItems,
  showSection,
  showDescription,
}: {
  items: TemplateItemDraft[];
  setItems: (items: TemplateItemDraft[]) => void;
  showSection?: boolean;
  showDescription?: boolean;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div
          key={idx}
          className="space-y-2 rounded-slate border border-line p-3"
        >
          <div className="flex flex-wrap gap-2">
            {showSection ? (
              <Select
                className="w-36"
                value={item.section || "VM"}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...item, section: e.target.value };
                  setItems(next);
                }}
              >
                {SETUP_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            ) : null}
            <Input
              className="min-w-[180px] flex-1"
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
          {showDescription ? (
            <Input
              placeholder="Optional description"
              value={item.description || ""}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...item, description: e.target.value };
                setItems(next);
              }}
            />
          ) : null}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={idx === 0}
              onClick={() => {
                if (idx === 0) return;
                const next = [...items];
                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                setItems(next);
              }}
            >
              Up
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={idx === items.length - 1}
              onClick={() => {
                if (idx >= items.length - 1) return;
                const next = [...items];
                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                setItems(next);
              }}
            >
              Down
            </Button>
          </div>
        </div>
      ))}
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
