/** Web Request/Response helpers shared by API adapters. Request bodies are bounded before decoding. */

import { ApiError, apiError } from "./common/api-error";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const BODY_LIMIT = 100 * 1024;

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: PRIVATE_HEADERS });
}

export function empty(status = 204): Response {
  return new Response(null, { status, headers: PRIVATE_HEADERS });
}

export async function readText(request: Request, maxBytes = BODY_LIMIT): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    throw apiError(413, "Request body too large.");
  }

  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      size += part.value.byteLength;
      if (size > maxBytes) {
        // Release the response without waiting for the sender to finish uploading.
        void reader.cancel().catch(() => {});
        throw apiError(413, "Request body too large.");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readJson(request: Request, maxBytes = BODY_LIMIT): Promise<unknown> {
  const body = await readText(request, maxBytes);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw apiError(400, "Malformed JSON.");
  }
}

/** Convert known failures to the wire error contract. Unexpected messages can contain secrets. */
export async function apiResponse(operation: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) return json({ detail: error.detail }, error.status);
    console.error("OMA request failed", error instanceof Error ? error.name : "Unknown error");
    return json({ detail: "Internal Server Error" }, 500);
  }
}
