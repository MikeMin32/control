import { SettingsView } from "@/components/settings/settings-view";
import {
  getOrCreateSettings,
  getTemplateEditor,
  listCompanies,
  listServers,
} from "@/lib/services/settings";
import { probeProxmox } from "@/lib/proxmox";
import { ensureDefaultTemplate } from "@/lib/services/wipeout";

export default async function SettingsPage() {
  await ensureDefaultTemplate();
  const [servers, companies, template, settings, proxmox] = await Promise.all([
    listServers(),
    listCompanies(),
    getTemplateEditor(),
    getOrCreateSettings(),
    probeProxmox(),
  ]);

  return (
    <SettingsView
      servers={servers}
      companies={companies}
      template={template!}
      timezone={settings.displayTimezone}
      proxmox={proxmox}
    />
  );
}
