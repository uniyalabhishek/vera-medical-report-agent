import "server-only";

import { randomUUID } from "node:crypto";
import type {
  Analysis,
  CaseState,
  CaseView,
  Fact,
  Intake,
  QuestionResponse,
} from "@/lib/contracts";
import { db } from "@/lib/server/db";
import { ApiError } from "@/lib/server/api-error";
import * as cloud from "@/lib/server/cloud-case-repository";
import { getStorageMode } from "@/lib/server/storage-mode";

const CASE_RETENTION_MS = 24 * 60 * 60 * 1_000;

type CaseRow = {
  id: string;
  state: CaseState;
  provider_mode: "demo" | "live";
  intake_json: string;
  facts_json: string;
  analysis_json: string | null;
  preferred_name: string;
  created_at: number;
  expires_at: number;
};

export type UploadRecord = {
  id: string;
  caseId: string;
  displayName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  sourceMode: "uploaded" | "demo";
};

function toView(row: CaseRow): CaseView {
  return {
    id: row.id,
    state: row.state,
    providerMode: row.provider_mode,
    intake: JSON.parse(row.intake_json) as Omit<Intake, "preferredName">,
    preferredName: row.preferred_name,
    facts: JSON.parse(row.facts_json) as Fact[],
    analysis: row.analysis_json ? (JSON.parse(row.analysis_json) as Analysis) : null,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function createCase(sessionHash: string, intake: Intake, providerMode: "demo" | "live") {
  if (getStorageMode() === "cloud") return cloud.createCase(sessionHash, intake, providerMode);
  const id = randomUUID();
  const now = Date.now();
  const expiresAt = now + CASE_RETENTION_MS;
  const { preferredName, ...clinicalIntake } = intake;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO cases
        (id, session_hash, state, provider_mode, intake_json, facts_json,
         analysis_json, created_at, updated_at, expires_at)
       VALUES (?, ?, 'DRAFT', ?, ?, '[]', NULL, ?, ?, ?)`,
    ).run(
      id,
      sessionHash,
      providerMode,
      JSON.stringify(clinicalIntake),
      now,
      now,
      expiresAt,
    );
    db.prepare("INSERT INTO case_identities (case_id, preferred_name) VALUES (?, ?)").run(
      id,
      preferredName,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getOwnedCase(id, sessionHash);
}

export async function countActiveCases(sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.countActiveCases(sessionHash);
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM cases WHERE session_hash = ? AND state != 'DELETED' AND expires_at > ?",
  ).get(sessionHash, Date.now()) as { count: number };
  return row.count;
}

export async function getOwnedCase(caseId: string, sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.getOwnedCase(caseId, sessionHash);
  const row = db
    .prepare(
      `SELECT c.id, c.state, c.provider_mode, c.intake_json, c.facts_json,
              c.analysis_json, c.created_at, c.expires_at, i.preferred_name
       FROM cases c
       JOIN case_identities i ON i.case_id = c.id
       WHERE c.id = ? AND c.session_hash = ? AND c.state != 'DELETED'`,
    )
    .get(caseId, sessionHash) as CaseRow | undefined;

  if (!row || row.expires_at <= Date.now()) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }

  return toView(row);
}

export async function setCaseFacts(
  caseId: string,
  sessionHash: string,
  facts: Fact[],
  state: CaseState,
) {
  if (getStorageMode() === "cloud") {
    return cloud.setCaseFacts(caseId, sessionHash, facts, state);
  }
  const result = db
    .prepare(
      `UPDATE cases SET facts_json = ?, state = ?, updated_at = ?
       WHERE id = ? AND session_hash = ? AND state != 'DELETED'`,
    )
    .run(JSON.stringify(facts), state, Date.now(), caseId, sessionHash);

  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
  return getOwnedCase(caseId, sessionHash);
}

export async function setCaseAnalysis(
  caseId: string,
  sessionHash: string,
  facts: Fact[],
  analysis: Analysis,
) {
  if (getStorageMode() === "cloud") {
    return cloud.setCaseAnalysis(caseId, sessionHash, facts, analysis);
  }
  const result = db
    .prepare(
      `UPDATE cases
       SET facts_json = ?, analysis_json = ?, state = 'READY', updated_at = ?
       WHERE id = ? AND session_hash = ? AND state != 'DELETED'`,
    )
    .run(JSON.stringify(facts), JSON.stringify(analysis), Date.now(), caseId, sessionHash);

  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
  return getOwnedCase(caseId, sessionHash);
}

export async function markCaseState(caseId: string, sessionHash: string, state: CaseState) {
  if (getStorageMode() === "cloud") return cloud.markCaseState(caseId, sessionHash, state);
  const result = db
    .prepare(
      `UPDATE cases SET state = ?, updated_at = ?
       WHERE id = ? AND session_hash = ? AND state != 'DELETED'`,
    )
    .run(state, Date.now(), caseId, sessionHash);

  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
}

export async function tryTransitionCaseState(
  caseId: string,
  sessionHash: string,
  fromStates: CaseState[],
  toState: CaseState,
) {
  if (getStorageMode() === "cloud") {
    return cloud.tryTransitionCaseState(caseId, sessionHash, fromStates, toState);
  }
  if (fromStates.length === 0) return false;
  const placeholders = fromStates.map(() => "?").join(", ");
  const result = db
    .prepare(
      `UPDATE cases SET state = ?, updated_at = ?
       WHERE id = ? AND session_hash = ? AND state IN (${placeholders}) AND expires_at > ?`,
    )
    .run(toState, Date.now(), caseId, sessionHash, ...fromStates, Date.now());
  return result.changes === 1;
}

export async function addUpload(
  caseId: string,
  sessionHash: string,
  upload: Omit<UploadRecord, "caseId">,
) {
  if (getStorageMode() === "cloud") return cloud.addUpload(caseId, sessionHash, upload);
  await getOwnedCase(caseId, sessionHash);
  db.prepare(
    `INSERT INTO uploads
      (id, case_id, display_name, stored_name, mime_type, size_bytes, source_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    upload.id,
    caseId,
    upload.displayName,
    upload.storedName,
    upload.mimeType,
    upload.sizeBytes,
    upload.sourceMode,
    Date.now(),
  );
  await markCaseState(caseId, sessionHash, "UPLOADED");
}

export async function listUploads(caseId: string, sessionHash: string): Promise<UploadRecord[]> {
  if (getStorageMode() === "cloud") return cloud.listUploads(caseId, sessionHash);
  await getOwnedCase(caseId, sessionHash);
  const rows = db
    .prepare(
      `SELECT id, case_id, display_name, stored_name, mime_type, size_bytes, source_mode
       FROM uploads WHERE case_id = ? ORDER BY created_at ASC`,
    )
    .all(caseId) as Array<{
    id: string;
    case_id: string;
    display_name: string;
    stored_name: string;
    mime_type: string;
    size_bytes: number;
    source_mode: "uploaded" | "demo";
  }>;

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    displayName: row.display_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sourceMode: row.source_mode,
  }));
}

export async function addConversationTurn(
  caseId: string,
  sessionHash: string,
  question: string,
  response: QuestionResponse,
) {
  if (getStorageMode() === "cloud") {
    return cloud.addConversationTurn(caseId, sessionHash, question, response);
  }
  await getOwnedCase(caseId, sessionHash);
  db.prepare(
    `INSERT INTO conversation_turns
      (id, case_id, question, response_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), caseId, question, JSON.stringify(response), Date.now());
}

export async function countConversationTurns(caseId: string, sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.countConversationTurns(caseId, sessionHash);
  await getOwnedCase(caseId, sessionHash);
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM conversation_turns WHERE case_id = ?",
  ).get(caseId) as { count: number };
  return row.count;
}

export async function deleteCase(caseId: string, sessionHash: string) {
  if (getStorageMode() === "cloud") return cloud.deleteCase(caseId, sessionHash);
  const result = db
    .prepare("DELETE FROM cases WHERE id = ? AND session_hash = ?")
    .run(caseId, sessionHash);
  if (result.changes !== 1) {
    throw new ApiError(404, "CASE_NOT_FOUND", "This case was not found or has expired.");
  }
}
