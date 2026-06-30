import { InboxWorkspace } from "@/components/InboxWorkspace";
import { loadDashboardData } from "@/lib/dashboard-data";
import { prisma } from "@/lib/db";
import { listRules } from "@/lib/rules";

// The dashboard reflects live database state (emails, rules), so it must be
// rendered per-request — never prerendered/cached at build time, or a deployed
// build would freeze on the empty build-time snapshot.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [data, rules] = await Promise.all([loadDashboardData(prisma), listRules(prisma)]);

  return <InboxWorkspace data={data} hasRules={rules.length > 0} />;
}
