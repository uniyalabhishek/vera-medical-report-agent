import "server-only";

import {
  SarvamAIClient,
  SarvamAIError,
  SarvamAITimeoutError,
} from "sarvamai";
import type { Intake } from "@/lib/contracts";
import type { ProviderDocumentChunk } from "@/lib/model/document-chunks";
import { ProviderConfigurationError, ProviderProcessingError } from "@/lib/model/provider";
import type { ExtractionOcrPage } from "@/lib/server/extraction-work";

const languageCodes: Record<Intake["documentLanguage"], string> = {
  English: "en-IN",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Kannada: "kn-IN",
  Marathi: "mr-IN",
};

const TERMINAL_STATUSES = new Set([
  "completed",
  "partially_completed",
  "failed",
  "rejected",
]);

type RuntimePage = {
  page_number?: number;
  page_num?: number;
  content?: string;
  blocks?: Array<{ text?: string }>;
};

let cachedClient: SarvamAIClient | null = null;

export class RetryableOcrProviderError extends Error {
  constructor() {
    super("The document reader is temporarily unavailable.");
    this.name = "RetryableOcrProviderError";
  }
}

function getClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.SARVAM_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderConfigurationError("Live report reading needs an approved Sarvam credential.");
  }
  cachedClient = new SarvamAIClient({
    apiSubscriptionKey: apiKey,
    maxRetries: 0,
    timeoutInSeconds: 60,
  });
  return cachedClient;
}

function providerFailure(error: unknown, stage: string): never {
  const statusCode = error instanceof SarvamAIError ? error.statusCode : undefined;
  const retryable =
    error instanceof SarvamAITimeoutError ||
    statusCode === 408 ||
    statusCode === 429 ||
    (typeof statusCode === "number" && statusCode >= 500);
  console.error(
    `Document reader ${stage} failed: ${error instanceof Error ? error.name : "UnknownError"}` +
      (statusCode ? ` (${statusCode})` : ""),
  );
  if (retryable) throw new RetryableOcrProviderError();
  throw new ProviderProcessingError(
    "One page group could not be read. The saved upload can be retried.",
  );
}

function validateUsage(
  usage: {
    pages_total?: number;
    pages_failed?: number;
    pages_succeeded?: number;
    pages_processed?: number;
  } | undefined,
  expectedPages: number,
) {
  if (
    usage?.pages_total !== expectedPages ||
    usage.pages_failed !== 0 ||
    usage.pages_succeeded !== expectedPages ||
    usage.pages_processed !== expectedPages
  ) {
    throw new ProviderProcessingError(
      "The document reader did not confirm every page in one page group.",
    );
  }
}

export async function submitOcrChunk(
  chunk: ProviderDocumentChunk,
  language: Intake["documentLanguage"],
) {
  try {
    const started = await getClient().docAi.digitise({
      file: [{
        data: chunk.data,
        filename: `document-${chunk.documentOrder + 1}-part-${chunk.chunkIndex + 1}.${
          chunk.mimeType === "application/pdf"
            ? "pdf"
            : chunk.mimeType === "image/png" ? "png" : "jpg"
        }`,
        contentType: chunk.mimeType,
        contentLength: chunk.sizeBytes,
      }],
      language: languageCodes[language],
      output_format: "md",
      content_type: "mixed",
      auto_orient: "true",
    });
    if (!started.job_id?.trim()) {
      throw new ProviderProcessingError("The document reader did not return a job identifier.");
    }
    return started.job_id;
  } catch (error) {
    if (error instanceof ProviderConfigurationError || error instanceof ProviderProcessingError) {
      throw error;
    }
    providerFailure(error, "submission");
  }
}

export async function checkOcrChunk(jobId: string, expectedPages: number) {
  try {
    const response = await getClient().docAi.getStatus(jobId);
    const status = response.status.toLocaleLowerCase("en-IN");
    if (!TERMINAL_STATUSES.has(status)) return "pending" as const;
    if (status !== "completed") {
      throw new ProviderProcessingError(
        "The document reader could not finish every page in one page group.",
      );
    }
    validateUsage(response.usage, expectedPages);
    return "completed" as const;
  } catch (error) {
    if (error instanceof ProviderConfigurationError || error instanceof ProviderProcessingError) {
      throw error;
    }
    providerFailure(error, "status check");
  }
}

export async function fetchOcrChunkPages(
  jobId: string,
  pageOffset: number,
  expectedPages: number,
): Promise<ExtractionOcrPage[]> {
  try {
    const results = await getClient().docAi.getResults(jobId, { format: "json" });
    if (results.type !== "digitise" || results.status.toLocaleLowerCase("en-IN") !== "completed") {
      throw new ProviderProcessingError("The document reader returned an unexpected result.");
    }
    validateUsage(results.usage, expectedPages);
    if (results.documents.length !== 1) {
      throw new ProviderProcessingError("The document reader returned an unexpected document count.");
    }

    const runtimePages = (results.documents[0] as unknown as { pages?: RuntimePage[] }).pages ?? [];
    const pages = runtimePages.flatMap((page) => {
      const blockText = page.blocks
        ?.map((block) => block.text?.trim())
        .filter((text): text is string => Boolean(text))
        .join("\n");
      const chunkPage = page.page_number ?? page.page_num;
      if (!Number.isInteger(chunkPage) || !chunkPage || chunkPage < 1) return [];
      // A successfully processed separator page can be genuinely blank. Keep
      // the page in the coverage check instead of treating an empty string as
      // a missing provider result.
      const text = (page.content ?? blockText ?? "").replace(/\u0000/g, "").trim();
      return [{ page: pageOffset + chunkPage, text }];
    });

    const expectedPageNumbers = Array.from(
      { length: expectedPages },
      (_, index) => pageOffset + index + 1,
    );
    const actualPageNumbers = pages.map((page) => page.page).toSorted((left, right) => left - right);
    if (
      pages.length !== expectedPages ||
      actualPageNumbers.some((page, index) => page !== expectedPageNumbers[index])
    ) {
      throw new ProviderProcessingError(
        "Readable text was not returned for every page in one page group.",
      );
    }
    return pages.toSorted((left, right) => left.page - right.page);
  } catch (error) {
    if (error instanceof ProviderConfigurationError || error instanceof ProviderProcessingError) {
      throw error;
    }
    providerFailure(error, "result download");
  }
}
