import type {
  Analysis,
  DocumentCategory,
  Fact,
  Intake,
  QuestionResponse,
} from "@/lib/contracts";

export type ExtractionInput = {
  caseId: string;
  intake: Omit<Intake, "preferredName">;
  mode: "demo" | "uploaded";
  extractionScope?: "whole-case" | "ocr-page-group";
  documents: ProviderDocumentInfo[];
  ocrPages?: ProviderOcrPage[];
};

export type ProviderDocumentInfo = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  category: DocumentCategory;
};

export type ProviderDocument = ProviderDocumentInfo & {
  data: Uint8Array;
};

export type ProviderOcrPage = {
  documentId: string;
  documentName: string;
  page: number;
  text: string;
  documentCategory: DocumentCategory;
};

export type SynthesisInput = {
  caseId: string;
  intake: Omit<Intake, "preferredName">;
  facts: Fact[];
};

export type QuestionInput = SynthesisInput & {
  analysis: Analysis;
  question: string;
};

export interface MedicalReportProvider {
  readonly mode: "demo" | "live";
  extract(input: ExtractionInput): Promise<Fact[]>;
  synthesize(input: SynthesisInput): Promise<Analysis>;
  answer(input: QuestionInput): Promise<QuestionResponse>;
}

export class ProviderConfigurationError extends Error {
  readonly code = "PROVIDER_CONFIGURATION_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderProcessingError extends Error {
  readonly code = "PROVIDER_PROCESSING_FAILED";
  readonly reasonCode: ProviderProcessingReasonCode;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      reasonCode?: ProviderProcessingReasonCode;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ProviderProcessingError";
    this.reasonCode = options.reasonCode ?? "UNCLASSIFIED";
    this.retryable = options.retryable ?? false;
  }
}

export type ProviderProcessingReasonCode =
  | "UNCLASSIFIED"
  | "PROVIDER_TRANSIENT_FAILURE"
  | "PROVIDER_CONFIGURATION_REJECTED"
  | "PROVIDER_REQUEST_REJECTED"
  | "EXTRACTION_MAX_OUTPUT_TOKENS"
  | "EXTRACTION_CONTENT_FILTERED"
  | "EXTRACTION_RESPONSE_NOT_COMPLETED"
  | "EXTRACTION_REFUSED"
  | "EXTRACTION_MISSING_STRUCTURED_TEXT"
  | "EXTRACTION_MISSING_PARSED_OUTPUT"
  | "EXTRACTION_NO_FACTS"
  | "EXTRACTION_ALL_CANDIDATES_REJECTED";
