/** Serve only declared brand files to the signed-in console owner. */
import { getSessionUser } from "@/lib/dal";
import { loadBrandAsset, WorkspaceRequestError } from "@/lib/server/agent-workspace";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string; asset: string }> }) {
  if (!await getSessionUser()) return new Response(null, { status: 401, headers });
  const { id, asset } = await params;
  try {
    const result = await loadBrandAsset(id, asset);
    if (!result) return new Response(null, { status: 404, headers });
    const download = new URL(request.url).searchParams.has("download") || result.mediaType === "application/octet-stream";
    const filename = encodeURIComponent(result.filename.toWellFormed()).replace(/['()*]/g, (char) =>
      "%" + char.charCodeAt(0).toString(16).toUpperCase());
    return new Response(new Uint8Array(Buffer.from(result.content, "base64")), {
      headers: {
        ...headers,
        "Content-Type": download ? "application/octet-stream" : result.mediaType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      },
    });
  } catch (error) {
    if (!(error instanceof WorkspaceRequestError)) throw error;
    return new Response(null, { status: error.status === 503 ? 503 : 502, headers });
  }
}
