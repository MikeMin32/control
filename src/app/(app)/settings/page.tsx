import { SettingsView } from "@/components/settings/settings-view";
import {
  getOrCreateSettings,
  getSetupTemplateEditor,
  getTemplateEditor,
  listCompanies,
  listServers,
} from "@/lib/services/settings";
import { probeProxmox } from "@/lib/proxmox";
import { ensureDefaultTemplate } from "@/lib/services/wipeout";
import { ensureDefaultSetupTemplate } from "@/lib/services/setup";

export default async function SettingsPage() {
  await Promise.all([ensureDefaultTemplate(), ensureDefaultSetupTemplate()]);
  const [servers, companies, template, setupTemplate, settings, proxmox] =
    await Promise.all([
      listServers(),
      listCompanies(),
      getTemplateEditor(),
      getSetupTemplateEditor(),
      getOrCreateSettings(),
      probeProxmox(),
    ]);

  return (
    <SettingsView
      servers={servers}
      companies={companies}
      template={template!}
      setupTemplate={setupTemplate!}
      timezone={settings.displayTimezone}
      proxmox={proxmox}
    />
  );
}
