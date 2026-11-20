/** Readiness verifies the SQLite database at request time. */

import { connection } from "next/server";

import { getDb } from "@/lib/db";
import { json } from "@/lib/server/http";
import { loadSettings } from "@/lib/server/settings";

export async function GET() {
  await connection();
  try {
    loadSettings();
    getDb().prepare("SELECT 1").get();
    return json({ status: "ok", database: "ok" });
  } catch (error) {
    console.error("OMA readiness check failed", error instanceof Error ? error.name : "Unknown error");
    return json({ status: "unavailable" }, 503);
  }
}
