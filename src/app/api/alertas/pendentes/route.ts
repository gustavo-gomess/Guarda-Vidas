import { countUnacknowledged } from "@/features/alerts/queries";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/http";

/**
 * Number of alerts waiting for acknowledgement in the user's area, for the
 * badge in the menu (polled while a page is open). The badge is only a
 * reminder: the alerts themselves are always read from the database.
 */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return jsonResponse(401, { code: "UNAUTHENTICATED" });
  return jsonResponse(200, {
    open: await countUnacknowledged(session.actor),
  });
}
