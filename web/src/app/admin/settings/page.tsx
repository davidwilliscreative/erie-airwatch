import AdminSettings from "@/components/admin/AdminSettings";
import { getAdminContext } from "@/lib/admin-data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { mode, data } = await getAdminContext();
  return <AdminSettings mode={mode} data={data} />;
}
