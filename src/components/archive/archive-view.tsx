"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type {
  ClosureChecklist,
  ClosureChecklistItem,
  Company,
  Machine,
  MachineMigration,
  Proxy,
  ProxyAssignment,
  Server,
  User,
} from "@prisma/client";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { CLOSURE_REASON_LABELS } from "@/lib/labels";
import { formatCalendarDate, formatDate } from "@/lib/utils";

type Row = Machine & {
  server: Server;
  company: Company;
  closure:
    | (ClosureChecklist & {
        items: ClosureChecklistItem[];
        completedBy: User | null;
      })
    | null;
  proxyAssignments: (ProxyAssignment & { proxy: Proxy })[];
  migrations: (MachineMigration & {
    fromServer: Server;
    toServer: Server;
  })[];
};

export function ArchiveView({
  rows,
  timezone,
  selected,
  q,
}: {
  rows: Row[];
  timezone: string;
  selected: Row | null;
  q: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function openRow(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("id", id);
    router.push(`/archive?${sp.toString()}`);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Archive</h1>
        <p className="page-subtitle">
          Read-only closed records with full history preserved.
        </p>
      </div>

      <Input
        defaultValue={q}
        aria-label="Search archived VMs"
        className="max-w-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const sp = new URLSearchParams();
            if (e.currentTarget.value) sp.set("q", e.currentTarget.value);
            router.push(`/archive?${sp.toString()}`);
          }
        }}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-3 font-medium">VM</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted">
                  No archived machines.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-sidebar/40"
                  onClick={() => openRow(r.id)}
                >
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {r.vmid}
                  </td>
                  <td className="px-4 py-3">{r.company.name}</td>
                  <td className="px-4 py-3">{r.server.name}</td>
                  <td className="px-4 py-3">
                    {r.closure
                      ? CLOSURE_REASON_LABELS[r.closure.reason]
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {formatDate(r.archivedAt, timezone)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => router.push("/archive")}
        title={selected ? `Archived VM ${selected.vmid}` : "Archive"}
        wide
      >
        {selected ? (
          <div className="space-y-5 text-sm">
            <section className="space-y-1">
              <h3 className="font-medium">Overview</h3>
              <p>Company: {selected.company.name}</p>
              <p>Final server: {selected.server.name}</p>
              <p>
                Closure:{" "}
                {selected.closure
                  ? CLOSURE_REASON_LABELS[selected.closure.reason]
                  : "—"}
              </p>
              <p>Closed: {formatDate(selected.archivedAt, timezone)}</p>
            </section>

            {selected.migrations.length > 0 ? (
              <section>
                <h3 className="mb-2 font-medium">Migrations</h3>
                <ul className="space-y-2">
                  {selected.migrations.map((m) => (
                    <li key={m.id} className="text-muted">
                      {m.fromServer.name}:{m.fromVmid} → {m.toServer.name}:
                      {m.toVmid}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h3 className="mb-2 font-medium">Proxy history</h3>
              <ul className="space-y-2">
                {selected.proxyAssignments.map((a) => (
                  <li key={a.id}>
                    <span className="font-mono text-xs">{a.proxy.ip}</span>
                    <span className="text-muted">
                      {" "}
                      · {formatCalendarDate(a.startedAt)} →{" "}
                      {a.endedAt
                        ? formatCalendarDate(a.endedAt)
                        : "present"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {selected.closure ? (
              <section>
                <h3 className="mb-2 font-medium">Checklist</h3>
                <ul className="space-y-2">
                  {selected.closure.items.map((i) => (
                    <li key={i.id}>
                      <span className="font-medium">{i.status}</span> —{" "}
                      {i.label}
                      {i.naReason ? (
                        <span className="text-muted"> ({i.naReason})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
