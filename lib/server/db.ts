import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDataDirectory } from "@/lib/server/data-path";

declare global {
  var __medicalReportDb: DatabaseSync | undefined;
}

function createDatabase() {
  const dataDirectory = getDataDirectory();
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

  const database = new DatabaseSync(path.join(dataDirectory, "mvp.sqlite"));
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
      state TEXT NOT NULL,
      provider_mode TEXT NOT NULL,
      intake_json TEXT NOT NULL,
      facts_json TEXT NOT NULL DEFAULT '[]',
      analysis_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS case_identities (
      case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
      preferred_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      source_mode TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_turns (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cases_session ON cases(session_hash);
    CREATE INDEX IF NOT EXISTS idx_uploads_case ON uploads(case_id);
    CREATE INDEX IF NOT EXISTS idx_turns_case ON conversation_turns(case_id);
  `);

  return database;
}

function getDatabase() {
  if (!globalThis.__medicalReportDb) {
    globalThis.__medicalReportDb = createDatabase();
  }
  return globalThis.__medicalReportDb;
}

// Keep route-module imports side-effect free. Next.js loads routes in parallel during builds.
export const db = {
  exec(sql: string) {
    return getDatabase().exec(sql);
  },
  prepare(sql: string) {
    return getDatabase().prepare(sql);
  },
};
