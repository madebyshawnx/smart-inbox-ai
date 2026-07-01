import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { revokeAccess } from "@/lib/google/tokens";

/**
 * POST /api/user/delete-data
 *
 * Privacy "delete all my data" control. Wipes every row this app stores for the
 * user — classifications, emails, rules, profiles, suggestions, briefs, and the
 * Gmail connection — and best-effort revokes the Google grant first so no valid
 * token is left behind.
 *
 * Deletes run in FK-safe order: children before the parents they reference.
 * EmailClassification and UserFeedback reference EmailMessage; SmartRule
 * references PriorityProfile; so those go first.
 */
export async function POST(): Promise<NextResponse> {
  try {
    // Best-effort: revoke the Google grant before we drop the stored tokens.
    await revokeAccess(prisma);

    // All-or-nothing: wrap every deleteMany in a single transaction so a partial
    // failure can't leave the user's data half-wiped. The order is already
    // FK-safe (children before the parents they reference).
    const [
      userFeedback,
      emailClassifications,
      emails,
      rules,
      priorityProfiles,
      dismissedSuggestions,
      dailyEmailBriefs,
      connectedAccounts,
    ] = await prisma.$transaction([
      prisma.userFeedback.deleteMany(),
      prisma.emailClassification.deleteMany(),
      prisma.emailMessage.deleteMany(),
      prisma.smartRule.deleteMany(),
      prisma.priorityProfile.deleteMany(),
      prisma.dismissedSuggestion.deleteMany(),
      prisma.dailyEmailBrief.deleteMany(),
      prisma.connectedAccount.deleteMany(),
    ]);

    return NextResponse.json({
      ok: true,
      deleted: {
        userFeedback: userFeedback.count,
        emailClassifications: emailClassifications.count,
        emails: emails.count,
        rules: rules.count,
        priorityProfiles: priorityProfiles.count,
        dismissedSuggestions: dismissedSuggestions.count,
        dailyEmailBriefs: dailyEmailBriefs.count,
        connectedAccounts: connectedAccounts.count,
      },
    });
  } catch (err) {
    console.error("[user/delete-data] delete failed:", err);
    return NextResponse.json({ error: "Could not delete your data." }, { status: 500 });
  }
}
