import "server-only";

import { FactsSchema } from "@/lib/contracts";
import type { CaseView, ExtractionProgress, Fact } from "@/lib/contracts";
import {
  materializeProviderDocumentChunk,
  planProviderDocumentChunks,
} from "@/lib/model/document-chunks";
import type { ProviderDocument, ProviderDocumentInfo, ProviderOcrPage } from "@/lib/model/provider";
import { ProviderProcessingError } from "@/lib/model/provider";
import { getProvider } from "@/lib/model/gateway";
import {
  checkOcrChunk,
  fetchOcrChunkPages,
  RetryableOcrProviderError,
  submitOcrChunk,
} from "@/lib/model/live-ocr";
import {
  initializeExtractionWork,
  listExtractionWork,
  resetFailedExtractionWork,
  resetFailedModelWork,
  updateExtractionWork,
  updateModelWork,
} from "@/lib/server/case-repository";
import type {
  ExtractionWorkKey,
  ExtractionWorkRecord,
  ExtractionWorkUpdate,
  ModelWorkUpdate,
  UploadRecord,
} from "@/lib/server/case-repository";
import { claimProviderCallSlot } from "@/lib/server/provider-call-slots";
import { getStoredUploadData } from "@/lib/server/uploads";

const PROVIDER_SLOT = "sarvam-document-ai";
const PROVIDER_CALL_INTERVAL_MS = 6_500;
const WORK_LEASE_MS = 90_000;
const MODEL_LEASE_MS = 100_000;
const TRANSIENT_RETRY_MS = 12_000;
const MODEL_RETRY_MS = 2_000;
const MAX_MODEL_ATTEMPTS = 2;

export type LiveExtractionResult =
  | {
      kind: "pending";
      progress: ExtractionProgress;
      retryAfterMs: number;
    }
  | {
      kind: "complete";
      facts: Fact[];
      progress: ExtractionProgress;
    };

type RunnerInput = {
  caseView: CaseView;
  sessionHash: string;
  uploads: UploadRecord[];
  retryFailed: boolean;
};

type RunnerDependencies = {
  now: () => number;
  getUploadData: typeof getStoredUploadData;
  planDocuments: typeof planProviderDocumentChunks;
  materializeChunk: typeof materializeProviderDocumentChunk;
  listWork: typeof listExtractionWork;
  initializeWork: typeof initializeExtractionWork;
  updateWork: typeof updateExtractionWork;
  resetFailedWork: typeof resetFailedExtractionWork;
  updateModelWork: typeof updateModelWork;
  resetFailedModelWork: typeof resetFailedModelWork;
  claimProviderSlot: typeof claimProviderCallSlot;
  submitChunk: typeof submitOcrChunk;
  checkChunk: typeof checkOcrChunk;
  fetchChunkPages: typeof fetchOcrChunkPages;
  extractFacts: (input: {
    caseView: CaseView;
    documents: ProviderDocumentInfo[];
    pages: ProviderOcrPage[];
  }) => Promise<Fact[]>;
};

const defaultDependencies: RunnerDependencies = {
  now: Date.now,
  getUploadData: getStoredUploadData,
  planDocuments: planProviderDocumentChunks,
  materializeChunk: materializeProviderDocumentChunk,
  listWork: listExtractionWork,
  initializeWork: initializeExtractionWork,
  updateWork: updateExtractionWork,
  resetFailedWork: resetFailedExtractionWork,
  updateModelWork,
  resetFailedModelWork,
  claimProviderSlot: claimProviderCallSlot,
  submitChunk: submitOcrChunk,
  checkChunk: checkOcrChunk,
  fetchChunkPages: fetchOcrChunkPages,
  extractFacts: async ({ caseView, documents, pages }) => getProvider("uploaded").extract({
    caseId: caseView.id,
    intake: caseView.intake,
    mode: "uploaded",
    documents,
    ocrPages: pages,
    extractionScope: "ocr-page-group",
  }),
};

function opaqueDocumentName(upload: UploadRecord, documentOrder: number) {
  const extension = upload.mimeType === "application/pdf"
    ? "pdf"
    : upload.mimeType === "image/png" ? "png" : "jpg";
  return `report-${documentOrder + 1}.${extension}`;
}

function documentInfo(upload: UploadRecord, documentOrder: number): ProviderDocumentInfo {
  return {
    id: upload.id,
    name: opaqueDocumentName(upload, documentOrder),
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
    category: upload.category,
  };
}

function progressFor(work: ExtractionWorkRecord[]): ExtractionProgress {
  const checking = work.length > 0 && work.every((item) => item.status === "completed");
  return {
    completedPages: work.reduce(
      (total, item) => total + (item.status === "completed" ? item.pageCount : 0),
      0,
    ),
    totalPages: work.reduce((total, item) => total + item.pageCount, 0),
    stage: checking ? "checking" : "reading",
    retrying: checking && work.some((item) =>
      item.modelStatus === "pending" && item.modelAttempts > 0
    ),
  };
}

function pending(work: ExtractionWorkRecord[], retryAfterMs: number): LiveExtractionResult {
  return {
    kind: "pending",
    progress: progressFor(work),
    retryAfterMs: Math.max(250, Math.ceil(retryAfterMs)),
  };
}

function workKey(work: ExtractionWorkRecord): ExtractionWorkKey {
  return { uploadId: work.uploadId, chunkIndex: work.chunkIndex };
}

function nextAvailableWork(work: ExtractionWorkRecord[], now: number) {
  const priority = { pending: 0, results_pending: 1, submitted: 2, failed: 3 } as const;
  return work
    .filter((item) =>
      item.status !== "completed" && (!item.leaseExpiresAt || item.leaseExpiresAt <= now)
    )
    .toSorted((left, right) => {
      const byStatus = priority[left.status as keyof typeof priority] -
        priority[right.status as keyof typeof priority];
      return byStatus || left.updatedAt - right.updatedAt;
    })[0];
}

function nextAvailableModelWork(
  work: ExtractionWorkRecord[],
  uploads: UploadRecord[],
  now: number,
) {
  const uploadOrder = new Map(uploads.map((upload, index) => [upload.id, index]));
  return work
    .filter((item) =>
      item.status === "completed" &&
      item.modelStatus === "pending" &&
      (!item.modelLeaseExpiresAt || item.modelLeaseExpiresAt <= now)
    )
    .toSorted((left, right) => {
      const byUpload = (uploadOrder.get(left.uploadId) ?? Number.MAX_SAFE_INTEGER) -
        (uploadOrder.get(right.uploadId) ?? Number.MAX_SAFE_INTEGER);
      return byUpload || left.chunkIndex - right.chunkIndex;
    })[0];
}

function workUpdate(
  work: ExtractionWorkRecord,
  changes: Partial<Omit<ExtractionWorkUpdate, "expectedUpdatedAt">>,
): ExtractionWorkUpdate {
  return {
    expectedUpdatedAt: work.updatedAt,
    status: work.status,
    providerJobId: work.providerJobId,
    ocrPages: work.ocrPages,
    attempts: work.attempts,
    leaseExpiresAt: work.leaseExpiresAt,
    ...changes,
  };
}

function modelWorkUpdate(
  work: ExtractionWorkRecord,
  changes: Partial<Omit<ModelWorkUpdate, "expectedUpdatedAt">>,
): ModelWorkUpdate {
  return {
    expectedUpdatedAt: work.updatedAt,
    modelStatus: work.modelStatus,
    modelFacts: work.modelFacts,
    modelAttempts: work.modelAttempts,
    modelErrorCode: work.modelErrorCode,
    modelLeaseExpiresAt: work.modelLeaseExpiresAt,
    ...changes,
  };
}

function factDedupeKey(fact: Fact) {
  const source = `${fact.source.documentId}:${fact.source.page}:${fact.source.documentCategory}`;
  return fact.kind === "observation"
    ? [
        "observation",
        source,
        fact.name,
        fact.value,
        fact.unit,
        fact.referenceRange,
        fact.effectiveDate,
      ].join("\u0000")
    : [
        "medication",
        source,
        fact.medicine,
        fact.dose,
        fact.frequency,
        fact.duration,
      ].join("\u0000");
}

function mergeCompletedFacts(work: ExtractionWorkRecord[], uploads: UploadRecord[]) {
  const uploadOrder = new Map(uploads.map((upload, index) => [upload.id, index]));
  const orderedWork = work.toSorted((left, right) => {
    const byUpload = (uploadOrder.get(left.uploadId) ?? Number.MAX_SAFE_INTEGER) -
      (uploadOrder.get(right.uploadId) ?? Number.MAX_SAFE_INTEGER);
    return byUpload || left.chunkIndex - right.chunkIndex;
  });
  const seen = new Set<string>();
  const merged: Fact[] = [];

  for (const item of orderedWork) {
    if (item.modelStatus !== "completed" || item.modelFacts === null) {
      throw new ProviderProcessingError("Saved report details are incomplete.");
    }
    const firstPage = item.pageOffset + 1;
    const lastPage = item.pageOffset + item.pageCount;
    for (const fact of item.modelFacts) {
      if (
        fact.source.documentId !== item.uploadId ||
        fact.source.page < firstPage ||
        fact.source.page > lastPage
      ) {
        throw new ProviderProcessingError("A saved report detail does not match its page group.");
      }
      const key = factDedupeKey(fact);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(fact);
    }
  }

  if (merged.length === 0) {
    throw new ProviderProcessingError(
      "No source-backed lab values or prescription instructions were found. Try a clearer report.",
      { reasonCode: "EXTRACTION_NO_FACTS" },
    );
  }
  const facts = FactsSchema.parse(merged);
  const coveredDocuments = new Set(facts.map((fact) => fact.source.documentId));
  if (uploads.some((upload) => !coveredDocuments.has(upload.id))) {
    throw new ProviderProcessingError(
      "At least one uploaded file could not be linked to an accepted detail. No partial explanation was shown.",
      { reasonCode: "EXTRACTION_NO_FACTS" },
    );
  }
  return facts;
}

async function loadDocuments(
  uploads: UploadRecord[],
  caseId: string,
  getUploadData: RunnerDependencies["getUploadData"],
): Promise<ProviderDocument[]> {
  const documents: ProviderDocument[] = [];
  for (const [documentOrder, upload] of uploads.entries()) {
    documents.push({
      ...documentInfo(upload, documentOrder),
      data: await getUploadData(caseId, upload.storedName),
    });
  }
  return documents;
}

async function releaseLease(
  input: RunnerInput,
  work: ExtractionWorkRecord,
  dependencies: RunnerDependencies,
) {
  await dependencies.updateWork(
    input.caseView.id,
    input.sessionHash,
    workKey(work),
    workUpdate(work, { leaseExpiresAt: null }),
  );
}

export function createLiveExtractionRunner(
  dependencyOverrides: Partial<RunnerDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  return async function advanceLiveExtraction(input: RunnerInput): Promise<LiveExtractionResult> {
    const { caseView, sessionHash, uploads } = input;
    if (uploads.length === 0) {
      throw new ProviderProcessingError("Add at least one report before reading starts.");
    }

    let work = await dependencies.listWork(caseView.id, sessionHash);
    if (work.length === 0) {
      const documents = await loadDocuments(uploads, caseView.id, dependencies.getUploadData);
      const plans = await dependencies.planDocuments(documents);
      work = await dependencies.initializeWork(
        caseView.id,
        sessionHash,
        plans.map((plan) => ({
          uploadId: plan.documentId,
          chunkIndex: plan.chunkIndex,
          pageOffset: plan.originalFirstPage - 1,
          pageCount: plan.pageCount,
        })),
      );
    }

    if (input.retryFailed) {
      for (const item of work) {
        if (item.status !== "failed") continue;
        await dependencies.resetFailedWork(
          caseView.id,
          sessionHash,
          workKey(item),
          item.updatedAt,
        );
      }
      work = await dependencies.listWork(caseView.id, sessionHash);
      for (const item of work) {
        if (item.modelStatus !== "failed") continue;
        await dependencies.resetFailedModelWork(
          caseView.id,
          sessionHash,
          workKey(item),
          item.updatedAt,
        );
      }
      work = await dependencies.listWork(caseView.id, sessionHash);
    }

    if (work.some((item) => item.status === "failed")) {
      throw new ProviderProcessingError(
        "One page group could not be read. The saved upload can be retried.",
      );
    }

    const allCompleted = work.every((item) => item.status === "completed");
    if (allCompleted) {
      if (work.length === 0) {
        throw new ProviderProcessingError("No readable page groups were prepared.");
      }
      if (work.some((item) => item.modelStatus === "failed")) {
        throw new ProviderProcessingError(
          "One page group could not be checked. The saved pages can be retried.",
        );
      }
      if (work.every((item) => item.modelStatus === "completed")) {
        return {
          kind: "complete",
          facts: mergeCompletedFacts(work, uploads),
          progress: progressFor(work),
        };
      }

      const now = dependencies.now();
      const activeModelWork = work.find((item) =>
        item.modelStatus === "pending" &&
        item.modelLeaseExpiresAt !== null &&
        item.modelLeaseExpiresAt > now
      );
      if (activeModelWork?.modelLeaseExpiresAt) {
        return pending(work, activeModelWork.modelLeaseExpiresAt - now);
      }

      const nextModelWork = nextAvailableModelWork(work, uploads, now);
      if (!nextModelWork) return pending(work, 1_000);
      const claimed = await dependencies.updateModelWork(
        caseView.id,
        sessionHash,
        workKey(nextModelWork),
        modelWorkUpdate(nextModelWork, { modelLeaseExpiresAt: now + MODEL_LEASE_MS }),
      );
      if (!claimed) return pending(work, 750);

      try {
        const documentOrder = uploads.findIndex((upload) => upload.id === claimed.uploadId);
        const upload = uploads[documentOrder];
        if (!upload || !claimed.ocrPages || claimed.ocrPages.length !== claimed.pageCount) {
          throw new ProviderProcessingError("Saved page text is incomplete.");
        }
        const pages: ProviderOcrPage[] = claimed.ocrPages.map((page) => ({
          documentId: claimed.uploadId,
          documentName: opaqueDocumentName(upload, documentOrder),
          page: page.page,
          text: page.text,
          documentCategory: upload.category,
        }));
        const documents = [documentInfo(upload, documentOrder)];
        const facts = await dependencies.extractFacts({ caseView, documents, pages });
        await dependencies.updateModelWork(
          caseView.id,
          sessionHash,
          workKey(claimed),
          modelWorkUpdate(claimed, {
            modelStatus: "completed",
            modelFacts: facts,
            modelAttempts: claimed.modelAttempts + 1,
            modelErrorCode: null,
            modelLeaseExpiresAt: null,
          }),
        );
      } catch (error) {
        const attempts = claimed.modelAttempts + 1;
        const retryable = error instanceof ProviderProcessingError && error.retryable &&
          attempts < MAX_MODEL_ATTEMPTS;
        await dependencies.updateModelWork(
          caseView.id,
          sessionHash,
          workKey(claimed),
          modelWorkUpdate(claimed, {
            modelStatus: retryable ? "pending" : "failed",
            modelFacts: null,
            modelAttempts: attempts,
            modelErrorCode: error instanceof ProviderProcessingError
              ? error.reasonCode
              : "UNCLASSIFIED",
            modelLeaseExpiresAt: null,
          }),
        ).catch(() => undefined);
        if (retryable) {
          const updatedWork = await dependencies.listWork(caseView.id, sessionHash);
          return pending(updatedWork, MODEL_RETRY_MS);
        }
        throw error;
      }

      const updatedWork = await dependencies.listWork(caseView.id, sessionHash);
      if (updatedWork.every((item) => item.modelStatus === "completed")) {
        return {
          kind: "complete",
          facts: mergeCompletedFacts(updatedWork, uploads),
          progress: progressFor(updatedWork),
        };
      }
      return pending(updatedWork, 250);
    }

    const now = dependencies.now();
    const next = nextAvailableWork(work, now);
    if (!next) {
      const nearestLease = Math.min(...work.flatMap((item) =>
        item.leaseExpiresAt && item.leaseExpiresAt > now ? [item.leaseExpiresAt] : []
      ));
      return pending(work, Number.isFinite(nearestLease) ? nearestLease - now : 1_000);
    }

    const claimed = await dependencies.updateWork(
      caseView.id,
      sessionHash,
      workKey(next),
      workUpdate(next, { leaseExpiresAt: now + WORK_LEASE_MS }),
    );
    if (!claimed) return pending(work, 750);

    try {
      if (claimed.status === "pending") {
        const documentOrder = uploads.findIndex((upload) => upload.id === claimed.uploadId);
        const upload = uploads[documentOrder];
        if (!upload) throw new ProviderProcessingError("The saved upload could not be found.");
        const document: ProviderDocument = {
          ...documentInfo(upload, documentOrder),
          data: await dependencies.getUploadData(caseView.id, upload.storedName),
        };
        const chunk = await dependencies.materializeChunk(document, {
          documentId: claimed.uploadId,
          documentOrder,
          chunkIndex: claimed.chunkIndex,
          originalFirstPage: claimed.pageOffset + 1,
          pageCount: claimed.pageCount,
        });
        const slot = await dependencies.claimProviderSlot(
          PROVIDER_SLOT,
          PROVIDER_CALL_INTERVAL_MS,
        );
        if (!slot.claimed) {
          await releaseLease(input, claimed, dependencies).catch(() => undefined);
          return pending(work, slot.retryAfterMs);
        }
        const jobId = await dependencies.submitChunk(chunk, caseView.intake.documentLanguage);
        await dependencies.updateWork(
          caseView.id,
          sessionHash,
          workKey(claimed),
          workUpdate(claimed, {
            status: "submitted",
            providerJobId: jobId,
            attempts: claimed.attempts + 1,
            leaseExpiresAt: null,
          }),
        );
      } else if (claimed.status === "submitted") {
        if (!claimed.providerJobId) {
          throw new ProviderProcessingError("A saved document-reader job is incomplete.");
        }
        const slot = await dependencies.claimProviderSlot(
          PROVIDER_SLOT,
          PROVIDER_CALL_INTERVAL_MS,
        );
        if (!slot.claimed) {
          await releaseLease(input, claimed, dependencies).catch(() => undefined);
          return pending(work, slot.retryAfterMs);
        }
        const status = await dependencies.checkChunk(claimed.providerJobId, claimed.pageCount);
        await dependencies.updateWork(
          caseView.id,
          sessionHash,
          workKey(claimed),
          workUpdate(claimed, {
            status: status === "completed" ? "results_pending" : "submitted",
            leaseExpiresAt: null,
          }),
        );
      } else if (claimed.status === "results_pending") {
        if (!claimed.providerJobId) {
          throw new ProviderProcessingError("A saved document-reader job is incomplete.");
        }
        const slot = await dependencies.claimProviderSlot(
          PROVIDER_SLOT,
          PROVIDER_CALL_INTERVAL_MS,
        );
        if (!slot.claimed) {
          await releaseLease(input, claimed, dependencies).catch(() => undefined);
          return pending(work, slot.retryAfterMs);
        }
        const pages = await dependencies.fetchChunkPages(
          claimed.providerJobId,
          claimed.pageOffset,
          claimed.pageCount,
        );
        await dependencies.updateWork(
          caseView.id,
          sessionHash,
          workKey(claimed),
          workUpdate(claimed, {
            status: "completed",
            ocrPages: pages,
            leaseExpiresAt: null,
          }),
        );
      }
    } catch (error) {
      if (error instanceof RetryableOcrProviderError) {
        await releaseLease(input, claimed, dependencies).catch(() => undefined);
        return pending(work, TRANSIENT_RETRY_MS);
      }
      await dependencies.updateWork(
        caseView.id,
        sessionHash,
        workKey(claimed),
        workUpdate(claimed, { status: "failed", leaseExpiresAt: null }),
      ).catch(() => undefined);
      throw error;
    }

    const updatedWork = await dependencies.listWork(caseView.id, sessionHash);
    return pending(updatedWork, PROVIDER_CALL_INTERVAL_MS);
  };
}

export const advanceLiveExtraction = createLiveExtractionRunner();
