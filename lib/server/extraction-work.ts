import "server-only";

import { FactSchema } from "@/lib/contracts";
import type { Fact } from "@/lib/contracts";

export const extractionWorkStatuses = [
  "pending",
  "submitted",
  "results_pending",
  "completed",
  "failed",
] as const;

export type ExtractionWorkStatus = (typeof extractionWorkStatuses)[number];

export const modelWorkStatuses = ["pending", "completed", "failed"] as const;

export type ModelWorkStatus = (typeof modelWorkStatuses)[number];

export type ExtractionOcrPage = {
  page: number;
  text: string;
};

export type ExtractionWorkKey = {
  uploadId: string;
  chunkIndex: number;
};

export type NewExtractionWork = ExtractionWorkKey & {
  /** Zero-based page offset in the original upload. */
  pageOffset: number;
  pageCount: number;
};

export type ExtractionWorkRecord = NewExtractionWork & {
  caseId: string;
  status: ExtractionWorkStatus;
  providerJobId: string | null;
  ocrPages: ExtractionOcrPage[] | null;
  attempts: number;
  leaseExpiresAt: number | null;
  modelStatus: ModelWorkStatus;
  /** `[]` is a completed model result with no accepted facts; `null` means no result. */
  modelFacts: Fact[] | null;
  modelAttempts: number;
  modelErrorCode: string | null;
  modelLeaseExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ExtractionWorkUpdate = {
  /** Compare-and-set token from the last read. */
  expectedUpdatedAt: number;
  status: ExtractionWorkStatus;
  providerJobId: string | null;
  ocrPages: ExtractionOcrPage[] | null;
  attempts: number;
  leaseExpiresAt: number | null;
};

export type ModelWorkUpdate = {
  /** Compare-and-set token from the last read. */
  expectedUpdatedAt: number;
  modelStatus: ModelWorkStatus;
  modelFacts: Fact[] | null;
  modelAttempts: number;
  modelErrorCode: string | null;
  modelLeaseExpiresAt: number | null;
};

export type ExtractionWorkRow = {
  case_id: string;
  upload_id: string;
  chunk_index: string | number;
  page_offset: string | number;
  page_count: string | number;
  status: string;
  provider_job_id: string | null;
  ocr_pages_json: string | null;
  attempts: string | number;
  lease_expires_at: string | number | null;
  model_status: string;
  model_facts_json: string | null;
  model_attempts: string | number;
  model_error_code: string | null;
  model_lease_expires_at: string | number | null;
  created_at: string | number;
  updated_at: string | number;
};

function parseOcrPages(value: string | null): ExtractionOcrPage[] | null {
  if (value === null) return null;
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((page) =>
      typeof page !== "object" ||
      page === null ||
      !Number.isInteger((page as { page?: unknown }).page) ||
      Number((page as { page: number }).page) <= 0 ||
      typeof (page as { text?: unknown }).text !== "string"
    )
  ) {
    throw new Error("Persisted extraction OCR pages are invalid.");
  }
  return parsed as ExtractionOcrPage[];
}

export function serializeOcrPages(pages: ExtractionOcrPage[] | null) {
  return pages === null ? null : JSON.stringify(pages);
}

function parseModelFacts(value: string | null): Fact[] | null {
  if (value === null) return null;
  return FactSchema.array().parse(JSON.parse(value) as unknown);
}

export function serializeModelFacts(facts: Fact[] | null) {
  return facts === null ? null : JSON.stringify(FactSchema.array().parse(facts));
}

export function hasSameExtractionGeometry(
  record: ExtractionWorkRecord,
  input: NewExtractionWork,
) {
  return record.uploadId === input.uploadId &&
    record.chunkIndex === input.chunkIndex &&
    record.pageOffset === input.pageOffset &&
    record.pageCount === input.pageCount;
}

export function hasExactExtractionPlan(
  records: ExtractionWorkRecord[],
  inputs: NewExtractionWork[],
) {
  if (records.length !== inputs.length) return false;
  const inputByKey = new Map(
    inputs.map((input) => [`${input.uploadId}:${input.chunkIndex}`, input]),
  );
  if (inputByKey.size !== inputs.length) return false;
  return records.every((record) => {
    const input = inputByKey.get(`${record.uploadId}:${record.chunkIndex}`);
    return Boolean(input && hasSameExtractionGeometry(record, input));
  });
}

export function toExtractionWorkRecord(row: ExtractionWorkRow): ExtractionWorkRecord {
  if (!extractionWorkStatuses.includes(row.status as ExtractionWorkStatus)) {
    throw new Error("Persisted extraction work status is invalid.");
  }
  if (!modelWorkStatuses.includes(row.model_status as ModelWorkStatus)) {
    throw new Error("Persisted extraction model status is invalid.");
  }
  return {
    caseId: row.case_id,
    uploadId: row.upload_id,
    chunkIndex: Number(row.chunk_index),
    pageOffset: Number(row.page_offset),
    pageCount: Number(row.page_count),
    status: row.status as ExtractionWorkStatus,
    providerJobId: row.provider_job_id,
    ocrPages: parseOcrPages(row.ocr_pages_json),
    attempts: Number(row.attempts),
    leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at),
    modelStatus: row.model_status as ModelWorkStatus,
    modelFacts: parseModelFacts(row.model_facts_json),
    modelAttempts: Number(row.model_attempts),
    modelErrorCode: row.model_error_code,
    modelLeaseExpiresAt: row.model_lease_expires_at === null
      ? null
      : Number(row.model_lease_expires_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
