import { connection } from "next/server";

/**
 * Server time, so the device can measure how wrong its clock is. The
 * measured offset travels with offline records as information for the
 * coordinator; it does not change the declared time. No data, no session.
 */
export async function GET() {
  await connection();
  return Response.json(
    { serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
