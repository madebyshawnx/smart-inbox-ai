import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadEmailGmailRef } from "@/lib/email-actions";
import { fetchUnsubscribeInfo, performOneClickUnsubscribe } from "@/lib/google/gmail-actions";
import { getAccessToken } from "@/lib/google/tokens";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/emails/[id]/unsubscribe
 *
 * Fetches the message's List-Unsubscribe / List-Unsubscribe-Post headers
 * on-demand (metadata format, read-only), then:
 *  - If an https RFC 8058 one-click URL is available: POSTs it and returns
 *    `{ ok: true, method: "one-click" }`.
 *  - Otherwise, if only a mailto: is available: returns
 *    `{ ok: false, mailto }` so the UI can hand it to the user. This app NEVER
 *    sends the mailto itself.
 *  - If no unsubscribe option exists: returns `{ ok: false, mailto: null }`.
 *
 * Fails soft with a clear error. No body required.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const email = await loadEmailGmailRef(prisma, id).catch(() => null);
  if (email === null) {
    return NextResponse.json({ error: "Email not found." }, { status: 404 });
  }
  if (email.gmailMessageId === null) {
    return NextResponse.json(
      { error: "This email is not a Gmail message and cannot be unsubscribed." },
      { status: 400 },
    );
  }

  try {
    const accessToken = await getAccessToken(prisma);
    const info = await fetchUnsubscribeInfo(accessToken, email.gmailMessageId);

    if (info.oneClick && info.httpsUrl !== null) {
      await performOneClickUnsubscribe(info.httpsUrl);
      console.info(
        `[emails/unsubscribe] method=one-click emailMessageId=${email.id} gmailMessageId=${email.gmailMessageId}`,
      );
      return NextResponse.json({ ok: true, method: "one-click" });
    }

    // No safe automatic path — return the mailto (if any) for the UI. We NEVER
    // send a mailto unsubscribe on the user's behalf.
    console.info(
      `[emails/unsubscribe] method=manual emailMessageId=${email.id} hasMailto=${info.mailto !== null}`,
    );
    return NextResponse.json({ ok: false, mailto: info.mailto });
  } catch (err) {
    console.error(`[emails/unsubscribe] emailMessageId=${email.id} failed:`, err);
    return NextResponse.json(
      { error: "Couldn't unsubscribe from this sender. Try reconnecting Gmail and retry." },
      { status: 502 },
    );
  }
}
