import { describe, expect, it, vi } from "vitest";
import type { CaseView, Fact } from "@/lib/contracts";
import type { ProviderDocumentChunkPlan } from "@/lib/model/document-chunks";
import { RetryableOcrProviderError } from "@/lib/model/live-ocr";
import { ProviderProcessingError } from "@/lib/model/provider";
import type {
  ExtractionWorkRecord,
  ExtractionWorkUpdate,
  ModelWorkUpdate,
  NewExtractionWork,
  UploadRecord,
} from "@/lib/server/case-repository";

vi.mock("server-only", () => ({}));

import { createLiveExtractionRunner } from "@/lib/server/live-extraction-runner";

const caseView: CaseView = {
  id: "case-1",
  state: "EXTRACTING",
  providerMode: "live",
  intake: {
    age: 42,
    language: "English",
    documentLanguage: "English",
    symptoms: "",
    medicalHistory: "",
  },
  preferredName: "Test",
  facts: [],
  analysis: null,
  createdAt: new Date(0).toISOString(),
  expiresAt: new Date(60_000).toISOString(),
};

const upload: UploadRecord = {
  id: "upload-1",
  caseId: caseView.id,
  displayName: "private-name.pdf",
  storedName: "stored.pdf",
  mimeType: "application/pdf",
  sizeBytes: 9_000_000,
  sourceMode: "uploaded",
  category: "report",
};

function fakeRepository() {
  let timestamp = 1;
  const work: ExtractionWorkRecord[] = [];
  const listWork = vi.fn(async () => work.map((item) => ({ ...item })));
  const upsertWork = vi.fn(async (_caseId: string, _sessionHash: string, input: NewExtractionWork) => {
    const existing = work.find((item) =>
      item.uploadId === input.uploadId && item.chunkIndex === input.chunkIndex
    );
    if (existing) return { ...existing };
    const created: ExtractionWorkRecord = {
      ...input,
      caseId: caseView.id,
      status: "pending",
      providerJobId: null,
      ocrPages: null,
      attempts: 0,
      leaseExpiresAt: null,
      modelStatus: "pending",
      modelFacts: null,
      modelAttempts: 0,
      modelErrorCode: null,
      modelLeaseExpiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp++,
    };
    work.push(created);
    return { ...created };
  });
  const initializeWork = vi.fn(async (
    _caseId: string,
    _sessionHash: string,
    inputs: NewExtractionWork[],
  ) => {
    for (const input of inputs) await upsertWork(_caseId, _sessionHash, input);
    return work.map((item) => ({ ...item }));
  });
  const updateWork = vi.fn(async (
    _caseId: string,
    _sessionHash: string,
    key: { uploadId: string; chunkIndex: number },
    update: ExtractionWorkUpdate,
  ) => {
    const index = work.findIndex((item) =>
      item.uploadId === key.uploadId &&
      item.chunkIndex === key.chunkIndex &&
      item.updatedAt === update.expectedUpdatedAt
    );
    if (index < 0) return null;
    work[index] = {
      ...work[index],
      ...update,
      updatedAt: timestamp++,
    };
    return { ...work[index] };
  });
  const resetFailedWork = vi.fn(async (
    _caseId: string,
    _sessionHash: string,
    key: { uploadId: string; chunkIndex: number },
    expectedUpdatedAt: number,
  ) => {
    const item = work.find((candidate) =>
      candidate.uploadId === key.uploadId &&
      candidate.chunkIndex === key.chunkIndex &&
      candidate.updatedAt === expectedUpdatedAt &&
      candidate.status === "failed"
    );
    if (!item) return null;
    Object.assign(item, {
      status: "pending",
      providerJobId: null,
      ocrPages: null,
      leaseExpiresAt: null,
      updatedAt: timestamp++,
    });
    return { ...item };
  });
  const updateModelWork = vi.fn(async (
    _caseId: string,
    _sessionHash: string,
    key: { uploadId: string; chunkIndex: number },
    update: ModelWorkUpdate,
  ) => {
    const index = work.findIndex((item) =>
      item.uploadId === key.uploadId &&
      item.chunkIndex === key.chunkIndex &&
      item.status === "completed" &&
      item.updatedAt === update.expectedUpdatedAt
    );
    if (index < 0) return null;
    work[index] = {
      ...work[index],
      ...update,
      updatedAt: timestamp++,
    };
    return { ...work[index] };
  });
  const resetFailedModelWork = vi.fn(async (
    _caseId: string,
    _sessionHash: string,
    key: { uploadId: string; chunkIndex: number },
    expectedUpdatedAt: number,
  ) => {
    const item = work.find((candidate) =>
      candidate.uploadId === key.uploadId &&
      candidate.chunkIndex === key.chunkIndex &&
      candidate.status === "completed" &&
      candidate.modelStatus === "failed" &&
      candidate.updatedAt === expectedUpdatedAt
    );
    if (!item) return null;
    Object.assign(item, {
      modelStatus: "pending",
      modelFacts: null,
      modelAttempts: 0,
      modelErrorCode: null,
      modelLeaseExpiresAt: null,
      updatedAt: timestamp++,
    });
    return { ...item };
  });
  return {
    listWork,
    initializeWork,
    updateWork,
    resetFailedWork,
    updateModelWork,
    resetFailedModelWork,
    getWork: () => work,
  };
}

function plan33Pages(): ProviderDocumentChunkPlan[] {
  return [
    { documentId: upload.id, documentOrder: 0, chunkIndex: 0, originalFirstPage: 1, pageCount: 10 },
    { documentId: upload.id, documentOrder: 0, chunkIndex: 1, originalFirstPage: 11, pageCount: 10 },
    { documentId: upload.id, documentOrder: 0, chunkIndex: 2, originalFirstPage: 21, pageCount: 10 },
    { documentId: upload.id, documentOrder: 0, chunkIndex: 3, originalFirstPage: 31, pageCount: 3 },
  ];
}

describe("durable live extraction runner", () => {
  it("submits, reads, and checks each generic page group once for a 33-page report", async () => {
    const repository = fakeRepository();
    const submitChunk = vi.fn(async (chunk: { chunkIndex: number }) => `job-${chunk.chunkIndex}`);
    const checkChunk = vi.fn(async () => "completed" as const);
    const fetchChunkPages = vi.fn(async (
      _jobId: string,
      pageOffset: number,
      pageCount: number,
    ) => Array.from({ length: pageCount }, (_, index) => ({
      page: pageOffset + index + 1,
      text: `Page ${pageOffset + index + 1}`,
    })));
    const fact = {
      id: "fact-1",
      kind: "observation",
      name: "HbA1c",
      value: "7.2",
      unit: "%",
      referenceRange: "4-6",
      numericRange: { kind: "closed", lower: 4, upper: 6 },
      flag: "high",
      effectiveDate: "",
      confirmed: true,
      needsReview: false,
      source: {
        id: "span-1",
        documentId: upload.id,
        documentName: upload.displayName,
        page: 1,
        excerpt: "HbA1c 7.2 %",
        bbox: [0, 0, 1, 1],
        documentCategory: "report",
      },
    } satisfies Fact;
    const extractFacts = vi.fn(async ({ pages }: { pages: Array<{ page: number }> }) =>
      pages[0]?.page === 1 ? [fact] : []
    );
    const runner = createLiveExtractionRunner({
      now: () => 1_000,
      getUploadData: vi.fn(async () => new Uint8Array([1, 2, 3])),
      planDocuments: vi.fn(async () => plan33Pages()),
      materializeChunk: vi.fn(async (document, plan) => ({ ...document, ...plan })),
      ...repository,
      claimProviderSlot: vi.fn(async () => ({ claimed: true as const, retryAfterMs: 0 as const })),
      submitChunk,
      checkChunk,
      fetchChunkPages,
      extractFacts,
    });

    let result;
    for (let step = 0; step < 24; step += 1) {
      result = await runner({
        caseView,
        sessionHash: "session-1",
        uploads: [upload],
        retryFailed: false,
      });
      if (result.kind === "complete") break;
    }

    expect(result).toMatchObject({
      kind: "complete",
      progress: { completedPages: 33, totalPages: 33 },
    });
    expect(submitChunk).toHaveBeenCalledTimes(4);
    expect(checkChunk).toHaveBeenCalledTimes(4);
    expect(fetchChunkPages).toHaveBeenCalledTimes(4);
    expect(extractFacts).toHaveBeenCalledTimes(4);
    expect(extractFacts.mock.calls.map(([input]) => input.pages.length)).toEqual([10, 10, 10, 3]);
    expect(repository.getWork().map((item) => item.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(repository.getWork().map((item) => item.modelStatus)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("retries only the failed model page group once and keeps completed OCR and model work", async () => {
    const repository = fakeRepository();
    const plans = plan33Pages().slice(0, 2).map((plan, index) => ({
      ...plan,
      originalFirstPage: index === 0 ? 1 : 11,
      pageCount: index === 0 ? 10 : 1,
    }));
    const submitChunk = vi.fn(async (chunk: { chunkIndex: number }) => `job-${chunk.chunkIndex}`);
    const checkChunk = vi.fn(async () => "completed" as const);
    const fetchChunkPages = vi.fn(async (
      _jobId: string,
      pageOffset: number,
      pageCount: number,
    ) => Array.from({ length: pageCount }, (_, index) => ({
      page: pageOffset + index + 1,
      text: `Page ${pageOffset + index + 1}`,
    })));
    const fact = {
      id: "fact-1",
      kind: "observation",
      name: "HbA1c",
      value: "7.2",
      unit: "%",
      referenceRange: "4-6",
      numericRange: { kind: "closed", lower: 4, upper: 6 },
      flag: "high",
      effectiveDate: "",
      confirmed: true,
      needsReview: false,
      source: {
        id: "span-1",
        documentId: upload.id,
        documentName: upload.displayName,
        page: 1,
        excerpt: "HbA1c 7.2 %",
        bbox: [0, 0, 1, 1],
        documentCategory: "report",
      },
    } satisfies Fact;
    let secondGroupCalls = 0;
    const extractFacts = vi.fn(async ({ pages }: { pages: Array<{ page: number }> }) => {
      if (pages[0]?.page === 1) return [fact];
      secondGroupCalls += 1;
      if (secondGroupCalls === 1) {
        throw new ProviderProcessingError("The extraction model returned no checked facts.", {
          reasonCode: "EXTRACTION_MISSING_PARSED_OUTPUT",
          retryable: true,
        });
      }
      return [];
    });
    const runner = createLiveExtractionRunner({
      now: () => 1_000,
      getUploadData: vi.fn(async () => new Uint8Array([1, 2, 3])),
      planDocuments: vi.fn(async () => plans),
      materializeChunk: vi.fn(async (document, plan) => ({ ...document, ...plan })),
      ...repository,
      claimProviderSlot: vi.fn(async () => ({ claimed: true as const, retryAfterMs: 0 as const })),
      submitChunk,
      checkChunk,
      fetchChunkPages,
      extractFacts,
    });

    let retryResult;
    let finalResult;
    for (let step = 0; step < 16; step += 1) {
      const result = await runner({
        caseView,
        sessionHash: "session-1",
        uploads: [upload],
        retryFailed: false,
      });
      if (result.kind === "pending" && result.progress.retrying) retryResult = result;
      if (result.kind === "complete") {
        finalResult = result;
        break;
      }
    }

    expect(retryResult).toMatchObject({
      kind: "pending",
      retryAfterMs: 2_000,
      progress: { completedPages: 11, totalPages: 11, stage: "checking", retrying: true },
    });
    expect(finalResult).toMatchObject({ kind: "complete", facts: [fact] });
    expect(submitChunk).toHaveBeenCalledTimes(2);
    expect(checkChunk).toHaveBeenCalledTimes(2);
    expect(fetchChunkPages).toHaveBeenCalledTimes(2);
    expect(extractFacts.mock.calls.map(([input]) => input.pages[0]?.page)).toEqual([1, 11, 11]);
    expect(repository.getWork().map((item) => item.modelAttempts)).toEqual([1, 2]);
  });

  it("stops after two retryable model failures", async () => {
    const repository = fakeRepository();
    const extractFacts = vi.fn(async () => {
      throw new ProviderProcessingError("The extraction model returned no checked facts.", {
        reasonCode: "EXTRACTION_MISSING_PARSED_OUTPUT",
        retryable: true,
      });
    });
    const runner = createLiveExtractionRunner({
      now: () => 1_000,
      getUploadData: vi.fn(async () => new Uint8Array([1])),
      planDocuments: vi.fn(async () => [plan33Pages()[3]]),
      materializeChunk: vi.fn(async (document, plan) => ({ ...document, ...plan })),
      ...repository,
      claimProviderSlot: vi.fn(async () => ({ claimed: true as const, retryAfterMs: 0 as const })),
      submitChunk: vi.fn(async () => "job-0"),
      checkChunk: vi.fn(async () => "completed" as const),
      fetchChunkPages: vi.fn(async () => [
        { page: 31, text: "Page 31" },
        { page: 32, text: "Page 32" },
        { page: 33, text: "Page 33" },
      ]),
      extractFacts,
    });

    for (let step = 0; step < 4; step += 1) {
      await runner({
        caseView,
        sessionHash: "session-1",
        uploads: [upload],
        retryFailed: false,
      });
    }
    await expect(runner({
      caseView,
      sessionHash: "session-1",
      uploads: [upload],
      retryFailed: false,
    })).rejects.toMatchObject({ reasonCode: "EXTRACTION_MISSING_PARSED_OUTPUT" });

    expect(extractFacts).toHaveBeenCalledTimes(2);
    expect(repository.getWork()[0]).toMatchObject({
      status: "completed",
      modelStatus: "failed",
      modelAttempts: 2,
      modelErrorCode: "EXTRACTION_MISSING_PARSED_OUTPUT",
      modelLeaseExpiresAt: null,
    });
  });

  it("keeps a transient provider failure resumable instead of failing the chunk", async () => {
    const repository = fakeRepository();
    const submitChunk = vi.fn()
      .mockRejectedValueOnce(new RetryableOcrProviderError())
      .mockResolvedValueOnce("job-0");
    const runner = createLiveExtractionRunner({
      now: () => 1_000,
      getUploadData: vi.fn(async () => new Uint8Array([1])),
      planDocuments: vi.fn(async () => [plan33Pages()[3]]),
      materializeChunk: vi.fn(async (document, plan) => ({ ...document, ...plan })),
      ...repository,
      claimProviderSlot: vi.fn(async () => ({ claimed: true as const, retryAfterMs: 0 as const })),
      submitChunk,
      checkChunk: vi.fn(),
      fetchChunkPages: vi.fn(),
      extractFacts: vi.fn(),
    });

    const first = await runner({
      caseView,
      sessionHash: "session-1",
      uploads: [upload],
      retryFailed: false,
    });
    expect(first).toMatchObject({ kind: "pending", retryAfterMs: 12_000 });
    expect(repository.getWork()[0]).toMatchObject({ status: "pending", leaseExpiresAt: null });

    await runner({
      caseView,
      sessionHash: "session-1",
      uploads: [upload],
      retryFailed: false,
    });
    expect(submitChunk).toHaveBeenCalledTimes(2);
    expect(repository.getWork()[0]).toMatchObject({
      status: "submitted",
      providerJobId: "job-0",
      attempts: 1,
    });
  });
});
