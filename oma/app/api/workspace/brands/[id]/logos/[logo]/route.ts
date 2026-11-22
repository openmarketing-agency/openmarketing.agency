/** Returns a signed-in owner’s image preview for a logo declared on a saved brand. */

import { getSessionUser } from "@/lib/dal";
import { loadBrandLogo } from "@/lib/server/agent-workspace";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; logo: string }> }) {
  if (!await getSessionUser()) return new Response(null, { status: 401, headers });
  const { id, logo } = await params;
  const result = await loadBrandLogo(id, logo);
  if (!result) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(Buffer.from(result.content, "base64")), {
    headers: { ...headers, "Content-Type": result.mediaType },
  });
}
