-- One non-archived machine per server + VMID
CREATE UNIQUE INDEX machine_server_vmid_active_uniq
  ON "Machine" ("serverId", "vmid")
  WHERE "archivedAt" IS NULL;

-- One open proxy assignment per proxy
CREATE UNIQUE INDEX proxy_assignment_open_proxy_uniq
  ON "ProxyAssignment" ("proxyId")
  WHERE "endedAt" IS NULL;

-- One open proxy assignment per machine
CREATE UNIQUE INDEX proxy_assignment_open_machine_uniq
  ON "ProxyAssignment" ("machineId")
  WHERE "endedAt" IS NULL;
