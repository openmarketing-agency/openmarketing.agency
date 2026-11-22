/** Keeps mock approval edits and review decisions in the signed-in account’s browser storage. */

"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";

import { approvalDraftSchema, type ApprovalDraft } from "./approvals";

const changesEvent = "oma:approval-drafts";
const draftSchema = z.record(z.string(), approvalDraftSchema);

function subscribe(listener: () => void) {
  window.addEventListener(changesEvent, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changesEvent, listener);
    window.removeEventListener("storage", listener);
  };
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function readDrafts(value: string): Record<string, ApprovalDraft> {
  if (!value) return {};
  try {
    const parsed = draftSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function useApprovalDrafts(userId: string) {
  const key = "oma:approval-drafts:" + userId;
  const snapshot = useSyncExternalStore(subscribe, () => readStorage(key), () => "");
  return {
    drafts: readDrafts(snapshot),
    save(id: string, draft: ApprovalDraft) {
      try {
        window.localStorage.setItem(key, JSON.stringify({ ...readDrafts(readStorage(key)), [id]: draft }));
      } catch {
        return false;
      }
      window.dispatchEvent(new Event(changesEvent));
      return true;
    },
  };
}
