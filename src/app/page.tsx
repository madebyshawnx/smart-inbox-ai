import { InboxWorkspace } from "@/components/InboxWorkspace";
import { loadDashboardData } from "@/lib/dashboard-data";
import { prisma } from "@/lib/db";

export default async function Home() {
  const data = await loadDashboardData(prisma);

  return <InboxWorkspace data={data} />;
}
