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
      category TEXT NOT NULL DEFAULT 'report',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extraction_work (
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      page_offset INTEGER NOT NULL CHECK (page_offset >= 0),
      page_count INTEGER NOT NULL CHECK (page_count > 0),
      status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'results_pending', 'completed', 'failed')),
      provider_job_id TEXT,
      ocr_pages_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      lease_expires_at INTEGER,
      model_status TEXT NOT NULL DEFAULT 'pending' CHECK (model_status IN ('pending', 'completed', 'failed')),
      model_facts_json TEXT,
      model_attempts INTEGER NOT NULL DEFAULT 0 CHECK (model_attempts >= 0),
      model_error_code TEXT,
      model_lease_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (case_id, upload_id, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS provider_call_slots (
      provider TEXT PRIMARY KEY,
      next_allowed_at INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_extraction_work_case_status
      ON extraction_work(case_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_turns_case ON conversation_turns(case_id);
  `);

  const uploadColumns = database.prepare("PRAGMA table_info(uploads)").all() as Array<{ name: string }>;
  if (!uploadColumns.some((column) => column.name === "category")) {
    database.exec("ALTER TABLE uploads ADD COLUMN category TEXT NOT NULL DEFAULT 'report'");
  }

  const extractionWorkColumns = database.prepare("PRAGMA table_info(extraction_work)").all() as Array<{
    name: string;
  }>;
  const hasExtractionWorkColumn = (name: string) =>
    extractionWorkColumns.some((column) => column.name === name);
  if (!hasExtractionWorkColumn("model_status")) {
    database.exec(
      "ALTER TABLE extraction_work ADD COLUMN model_status TEXT NOT NULL DEFAULT 'pending' CHECK (model_status IN ('pending', 'completed', 'failed'))",
    );
  }
  if (!hasExtractionWorkColumn("model_facts_json")) {
    database.exec("ALTER TABLE extraction_work ADD COLUMN model_facts_json TEXT");
  }
  if (!hasExtractionWorkColumn("model_attempts")) {
    database.exec(
      "ALTER TABLE extraction_work ADD COLUMN model_attempts INTEGER NOT NULL DEFAULT 0 CHECK (model_attempts >= 0)",
    );
  }
  if (!hasExtractionWorkColumn("model_error_code")) {
    database.exec("ALTER TABLE extraction_work ADD COLUMN model_error_code TEXT");
  }
  if (!hasExtractionWorkColumn("model_lease_expires_at")) {
    database.exec("ALTER TABLE extraction_work ADD COLUMN model_lease_expires_at INTEGER");
  }

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
