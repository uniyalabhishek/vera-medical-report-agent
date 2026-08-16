import "server-only";

import { PDFDocument } from "pdf-lib";
import type { ProviderDocument } from "@/lib/model/provider";
import { ProviderProcessingError } from "@/lib/model/provider";

export const MAX_DOCUMENT_CHUNK_PAGES = 10;
export const MAX_DOCUMENT_PAGES = 50;

export type ProviderDocumentChunkPlan = {
  documentId: string;
  /** Zero-based position of the source document in the inspected input list. */
  documentOrder: number;
  /** Zero-based part number within the original document. */
  chunkIndex: number;
  /** One-based page number in the original document. Images always start at page 1. */
  originalFirstPage: number;
  pageCount: number;
};

export type ProviderDocumentChunk = ProviderDocument & ProviderDocumentChunkPlan;

function processingError(message: string) {
  return new ProviderProcessingError(message);
}

async function inspectDocument(document: ProviderDocument) {
  if (document.data.byteLength === 0) {
    throw processingError("One uploaded document is empty or unreadable.");
  }

  if (document.mimeType === "image/jpeg" || document.mimeType === "image/png") {
    return { pageCount: 1, pdf: null };
  }

  if (document.mimeType !== "application/pdf") {
    throw processingError("Only PDF, JPEG, and PNG documents can be prepared for reading.");
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(document.data, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
  } catch {
    throw processingError("One PDF is encrypted, damaged, or unreadable.");
  }

  const pageCount = pdf.getPageCount();
  if (pageCount <= 0) {
    throw processingError("One PDF does not contain a readable page.");
  }
  return { pageCount, pdf };
}

function assertPlanShape(plan: ProviderDocumentChunkPlan) {
  if (
    !Number.isInteger(plan.documentOrder) ||
    plan.documentOrder < 0 ||
    !Number.isInteger(plan.chunkIndex) ||
    plan.chunkIndex < 0 ||
    !Number.isInteger(plan.originalFirstPage) ||
    plan.originalFirstPage < 1 ||
    !Number.isInteger(plan.pageCount) ||
    plan.pageCount < 1 ||
    plan.pageCount > MAX_DOCUMENT_CHUNK_PAGES
  ) {
    throw processingError("The saved document page plan is invalid.");
  }
}

/**
 * Inspects source documents and returns JSON-safe chunk metadata. No generated
 * chunk bytes or parsed PDF instances are retained in the returned plan.
 */
export async function planProviderDocumentChunks(
  documents: ProviderDocument[],
): Promise<ProviderDocumentChunkPlan[]> {
  const plans: ProviderDocumentChunkPlan[] = [];
  let totalPages = 0;

  for (const [documentOrder, document] of documents.entries()) {
    const inspection = await inspectDocument(document);
    totalPages += inspection.pageCount;
    if (totalPages > MAX_DOCUMENT_PAGES) {
      throw processingError("Use documents with no more than 50 pages in total.");
    }

    for (
      let pageOffset = 0;
      pageOffset < inspection.pageCount;
      pageOffset += MAX_DOCUMENT_CHUNK_PAGES
    ) {
      plans.push({
        documentId: document.id,
        documentOrder,
        chunkIndex: Math.floor(pageOffset / MAX_DOCUMENT_CHUNK_PAGES),
        originalFirstPage: pageOffset + 1,
        pageCount: Math.min(
          MAX_DOCUMENT_CHUNK_PAGES,
          inspection.pageCount - pageOffset,
        ),
      });
    }
  }
  return plans;
}

/** Materializes one previously planned chunk and revalidates it against its source. */
export async function materializeProviderDocumentChunk(
  document: ProviderDocument,
  plan: ProviderDocumentChunkPlan,
): Promise<ProviderDocumentChunk> {
  assertPlanShape(plan);
  if (plan.documentId !== document.id) {
    throw processingError("The saved document page plan does not match its source.");
  }

  const inspection = await inspectDocument(document);
  const expectedFirstPage = plan.chunkIndex * MAX_DOCUMENT_CHUNK_PAGES + 1;
  const expectedPageCount = Math.min(
    MAX_DOCUMENT_CHUNK_PAGES,
    inspection.pageCount - expectedFirstPage + 1,
  );
  if (
    plan.originalFirstPage !== expectedFirstPage ||
    expectedPageCount <= 0 ||
    plan.pageCount !== expectedPageCount
  ) {
    throw processingError("The saved document page plan does not match its source.");
  }

  if (!inspection.pdf) {
    return {
      ...document,
      sizeBytes: document.data.byteLength,
      ...plan,
    };
  }

  try {
    const pageOffset = plan.originalFirstPage - 1;
    const pageIndices = Array.from(
      { length: plan.pageCount },
      (_, index) => pageOffset + index,
    );
    const chunkPdf = await PDFDocument.create();
    const pages = await chunkPdf.copyPages(inspection.pdf, pageIndices);
    pages.forEach((page) => chunkPdf.addPage(page));
    const data = await chunkPdf.save();
    return {
      ...document,
      data,
      sizeBytes: data.byteLength,
      ...plan,
    };
  } catch (error) {
    if (error instanceof ProviderProcessingError) throw error;
    throw processingError("One PDF could not be divided into safe page groups.");
  }
}

/** Convenience wrapper that plans and then materializes all chunks in order. */
export async function chunkProviderDocuments(
  documents: ProviderDocument[],
): Promise<ProviderDocumentChunk[]> {
  const plans = await planProviderDocumentChunks(documents);
  const chunks: ProviderDocumentChunk[] = [];
  for (const plan of plans) {
    const document = documents[plan.documentOrder];
    if (!document) {
      throw processingError("The saved document page plan does not match its source.");
    }
    chunks.push(await materializeProviderDocumentChunk(document, plan));
  }
  return chunks;
}
