import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const openaiMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("openai", () => ({
  default: class {
    readonly responses = { parse: openaiMocks.parse };

    constructor(options: unknown) {
      openaiMocks.createClient(options);
    }
  },
}));
vi.mock("openai/helpers/zod", () => ({ zodTextFormat: vi.fn(() => ({})) }));

import { LiveMedicalReportProvider } from "@/lib/model/live-provider";
import { ProviderProcessingError } from "@/lib/model/provider";
import type { ExtractionInput } from "@/lib/model/provider";

const candidate = {
  kind: "observation" as const,
  name: "HbA1c",
  value: "7.2",
  unit: "%",
  referenceRange: "4.0 - 5.6",
  flag: "high" as const,
  effectiveDate: "",
  source: {
    documentId: "document-1",
    page: 1,
    excerpt: "HbA1c 7.2 % reference range 4.0 - 5.6",
    confidence: 0.99,
  },
};

const medicationCandidate = {
  kind: "medication" as const,
  medicine: "Vitamin D supplement",
  dose: "one capsule",
  frequency: "daily",
  duration: "30 days",
  source: {
    documentId: "document-1",
    page: 1,
    excerpt: "Vitamin D supplement one capsule daily for 30 days",
    confidence: 0.99,
  },
};

const pageGroupInput: ExtractionInput = {
  caseId: "case-1",
  intake: {
    age: 18,
    language: "English",
    documentLanguage: "English",
    symptoms: "",
    medicalHistory: "",
  },
  mode: "uploaded",
  extractionScope: "ocr-page-group",
  documents: [{
    id: "document-1",
    name: "report-1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_000,
    category: "report",
  }],
  ocrPages: [{
    documentId: "document-1",
    documentName: "report-1.pdf",
    page: 1,
    text: "HbA1c 7.2 % reference range 4.0 - 5.6",
    documentCategory: "report",
  }],
};

function response({
  status = "completed",
  incompleteReason = null,
  parsed = { facts: [candidate] } as unknown,
  content = [{
    type: "output_text",
    text: JSON.stringify(parsed),
    parsed,
  }] as unknown[],
}: {
  status?: string;
  incompleteReason?: "max_output_tokens" | "content_filter" | null;
  parsed?: unknown;
  content?: unknown[];
} = {}) {
  return {
    status,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    output: [{
      type: "message",
      role: "assistant",
      status: status === "completed" ? "completed" : "incomplete",
      content,
    }],
    output_text: "",
    output_parsed: parsed,
  };
}

describe("live extraction provider boundary", () => {
  beforeAll(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("SARVAM_API_KEY", "test-sarvam-key");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps existing processing errors terminal by default", () => {
    expect(new ProviderProcessingError("safe message")).toMatchObject({
      code: "PROVIDER_PROCESSING_FAILED",
      reasonCode: "UNCLASSIFIED",
      retryable: false,
    });
  });

  it("accepts completed, parsed, literal source-backed facts and requests 16,000 output tokens", async () => {
    openaiMocks.parse.mockResolvedValue(response());

    const facts = await new LiveMedicalReportProvider().extract(pageGroupInput);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: "observation",
      name: "HbA1c",
      value: "7.2",
      unit: "%",
      referenceRange: "4.0 - 5.6",
      flag: "high",
    });
    expect(openaiMocks.parse).toHaveBeenCalledWith(
      expect.objectContaining({ max_output_tokens: 16_000 }),
      { maxRetries: 0, timeout: 75_000 },
    );
  });

  it("accepts a legitimately empty OCR page group", async () => {
    openaiMocks.parse.mockResolvedValue(response({ parsed: { facts: [] } }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).resolves.toEqual([]);
  });

  it("ignores supplement suggestions and health advice on report pages", async () => {
    openaiMocks.parse.mockResolvedValue(response({
      parsed: { facts: [medicationCandidate] },
    }));

    await expect(
      new LiveMedicalReportProvider().extract({
        ...pageGroupInput,
        ocrPages: [{
          ...pageGroupInput.ocrPages![0],
          text: "Health advisory: Vitamin D supplement one capsule daily for 30 days",
        }],
      }),
    ).resolves.toEqual([]);
  });

  it("accepts literal medication instructions from a current prescription", async () => {
    openaiMocks.parse.mockResolvedValue(response({
      parsed: { facts: [medicationCandidate] },
    }));

    const facts = await new LiveMedicalReportProvider().extract({
      ...pageGroupInput,
      documents: [{ ...pageGroupInput.documents[0], category: "current-prescription" }],
      ocrPages: [{
        ...pageGroupInput.ocrPages![0],
        text: "Vitamin D supplement one capsule daily for 30 days",
        documentCategory: "current-prescription",
      }],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: "medication",
      medicine: "Vitamin D supplement",
      source: { documentCategory: "current-prescription" },
    });
  });

  it("keeps an empty whole-case extraction terminal", async () => {
    openaiMocks.parse.mockResolvedValue(response({ parsed: { facts: [] } }));

    await expect(new LiveMedicalReportProvider().extract({
      ...pageGroupInput,
      extractionScope: "whole-case",
    })).rejects.toMatchObject({
      reasonCode: "EXTRACTION_NO_FACTS",
      retryable: false,
    });
  });

  it("classifies max-output-token incompleteness as retryable", async () => {
    openaiMocks.parse.mockResolvedValue(response({
      status: "incomplete",
      incompleteReason: "max_output_tokens",
      parsed: null,
    }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).rejects.toMatchObject({
      code: "PROVIDER_PROCESSING_FAILED",
      reasonCode: "EXTRACTION_MAX_OUTPUT_TOKENS",
      retryable: true,
    });
  });

  it("classifies content filtering as terminal", async () => {
    openaiMocks.parse.mockResolvedValue(response({
      status: "incomplete",
      incompleteReason: "content_filter",
      parsed: null,
    }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).rejects.toMatchObject({
      reasonCode: "EXTRACTION_CONTENT_FILTERED",
      retryable: false,
    });
  });

  it("classifies other non-completed response statuses as retryable", async () => {
    openaiMocks.parse.mockResolvedValue(response({ status: "failed", parsed: null }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).rejects.toMatchObject({
      reasonCode: "EXTRACTION_RESPONSE_NOT_COMPLETED",
      retryable: true,
    });
  });

  it("classifies a refusal before checking for missing structured text", async () => {
    openaiMocks.parse.mockResolvedValue(response({
      parsed: null,
      content: [{ type: "refusal", refusal: "private provider refusal" }],
    }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).rejects.toMatchObject({
      reasonCode: "EXTRACTION_REFUSED",
      retryable: false,
    });
  });

  it("classifies missing structured text as retryable", async () => {
    openaiMocks.parse.mockResolvedValue(response({ parsed: null, content: [] }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).rejects.toMatchObject({
      reasonCode: "EXTRACTION_MISSING_STRUCTURED_TEXT",
      retryable: true,
    });
  });

  it("classifies missing parsed output after structured text as retryable", async () => {
    openaiMocks.parse.mockResolvedValue(response({
      parsed: null,
      content: [{ type: "output_text", text: "{}", parsed: null }],
    }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).rejects.toMatchObject({
      reasonCode: "EXTRACTION_MISSING_PARSED_OUTPUT",
      retryable: true,
    });
  });

  it("fails when candidates were returned but every candidate fails source checks", async () => {
    openaiMocks.parse.mockResolvedValue(response({
      parsed: {
        facts: [{
          ...candidate,
          source: { ...candidate.source, confidence: 0.4 },
        }],
      },
    }));

    await expect(
      new LiveMedicalReportProvider().extract(pageGroupInput),
    ).rejects.toMatchObject({
      reasonCode: "EXTRACTION_ALL_CANDIDATES_REJECTED",
      retryable: true,
    });
  });
});
