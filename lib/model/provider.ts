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
  documents: ProviderDocument[];
};

export type ProviderDocument = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  data: Uint8Array;
  category: DocumentCategory;
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

  constructor(message: string) {
    super(message);
    this.name = "ProviderProcessingError";
  }
}
