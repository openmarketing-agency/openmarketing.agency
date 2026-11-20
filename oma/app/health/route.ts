/** Liveness reports that the Next.js server can answer requests independently of SQLite. */

export function GET() {
  return Response.json({ status: "ok" });
}
