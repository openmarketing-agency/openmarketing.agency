import "server-only";
import { requireAccessToken, requireUser } from "@/lib/dal";
import { listToolAssignments } from "@/lib/backend";
import { connectionSnapshot, toolCatalog } from "@/lib/composio";
export async function loadToolWorkspace() {
  const user = await requireUser();
  const token = await requireAccessToken();
  const [snapshot, saved] = await Promise.all([
    connectionSnapshot(user.id),
    listToolAssignments(token),
  ]);
  const assignments = saved.ok ? saved.data : [];
  const slugs = [
    ...new Set([
      ...assignments.map((item) => item.toolkit_slug),
      ...snapshot.connected,
      ...(snapshot.reconnect ?? []),
      ...(snapshot.pending ?? []),
    ]),
  ];
  const metadata = await Promise.all(
    slugs.map(async (slug) => {
      try {
        return await (await toolCatalog()).get(slug);
      } catch {
        return {
          slug,
          name: slug,
          description: "Tool details are temporarily unavailable.",
          categories: [],
          noAuth: false,
          toolCount: 0,
        };
      }
    }),
  );
  return {
    snapshot,
    assignments,
    metadata,
    error: saved.ok ? undefined : saved.error.message,
  };
}
