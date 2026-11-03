import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getProxmoxStatusSync } from "@/lib/proxmox";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header email={user.email} proxmox={getProxmoxStatusSync()} />
        <main className="flex-1 overflow-auto p-5 md:p-6">{children}</main>
      </div>
    </div>
  );
}
