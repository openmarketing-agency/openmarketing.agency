/** Expose OMA's versioned bearer-authenticated API through the Next.js Node server. */

import { controlPlane } from "@/lib/server/control-plane";

async function handle(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return controlPlane(request, (await params).segments);
}

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
