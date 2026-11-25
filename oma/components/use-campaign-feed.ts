/** Refreshes private campaign data while visible and cancels requests when the view changes. */
"use client";

import { useEffect, useState } from "react";

type LoadState<T> = { path: string; data?: T; error?: string };
const refreshInterval = 12_000;

export function useCampaignFeed<T>(path: string, refresh: number, live = true) {
  const [state, setState] = useState<LoadState<T>>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let disposed = false;
    async function read() {
      if (disposed || request || document.hidden) return;
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch(path, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Couldn’t refresh campaign data.");
        if (!disposed) setState({ path, data: result as T });
      } catch (error) {
        if (!disposed) setState((previous) => ({
          path, data: previous?.path === path ? previous.data : undefined,
          error: error instanceof Error && error.name === "Error" ? error.message : "Couldn’t refresh campaign data.",
        }));
      } finally {
        request = undefined;
        if (live && !disposed && !document.hidden) timer = setTimeout(() => void read(), refreshInterval);
      }
    }

    function visibility() {
      clearTimeout(timer);
      if (!document.hidden) void read();
    }
    document.addEventListener("visibilitychange", visibility);
    void read();
    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [path, refresh, live]);
  return state?.path === path ? state : undefined;
}
