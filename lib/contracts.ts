import { z } from "zod";

export const supportedLanguages = [
  "English",
  "Hindi",
  "Tamil",
  "Kannada",
  "Marathi",
] as const;

export const IntakeSchema = z.object({
  preferredName: z.string().trim().min(1).max(80),
  age: z.coerce.number().int().min(18).max(120),
  language: z.enum(supportedLanguages),
  symptoms: z.string().trim().max(1_000).default(""),
  medicalHistory: z.string().trim().max(1_000).default(""),
});

export type Intake = z.infer<typeof IntakeSchema>;

export const SourceSpanSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  page: z.number().int().positive(),
  excerpt: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export type SourceSpan = z.infer<typeof SourceSpanSchema>;

const BaseFactSchema = z.object({
  id: z.string(),
  source: SourceSpanSchema,
  confirmed: z.boolean(),
  needsReview: z.boolean(),
});

export const ObservationFactSchema = BaseFactSchema.extend({
  kind: z.literal("observation"),
  name: z.string(),
  value: z.string(),
  unit: z.string(),
  referenceRange: z.string(),
  flag: z.enum(["high", "low", "normal", "not_provided"]),
  effectiveDate: z.string(),
});

export const MedicationFactSchema = BaseFactSchema.extend({
  kind: z.literal("medication"),
  medicine: z.string(),
  dose: z.string(),
  frequency: z.string(),
  duration: z.string(),
});

export const FactSchema = z.discriminatedUnion("kind", [
  ObservationFactSchema,
  MedicationFactSchema,
]);

export const FactsSchema = z.array(FactSchema).min(1);

export type ObservationFact = z.infer<typeof ObservationFactSchema>;
export type MedicationFact = z.infer<typeof MedicationFactSchema>;
export type Fact = z.infer<typeof FactSchema>;

export const CitationSchema = z.object({
  sourceSpanId: z.string(),
  label: z.string(),
});

export const AnalysisCardSchema = z.object({
  id: z.enum(["documents", "findings", "changes", "instructions", "questions"]),
  title: z.string(),
  body: z.string(),
  citations: z.array(CitationSchema),
});

export const AnalysisSchema = z.object({
  providerMode: z.enum(["demo", "live"]),
  checkedDocumentCount: z.number().int().positive(),
  cards: z.array(AnalysisCardSchema).length(5),
  suggestedQuestions: z.array(z.string()).min(2),
  generatedAt: z.string(),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

export const QuestionRequestSchema = z.object({
  question: z.string().trim().min(2).max(500),
});

export const QuestionResponseSchema = z.object({
  answerType: z.enum(["document_fact", "approved_explanation", "cannot_determine", "boundary"]),
  answer: z.string(),
  citations: z.array(CitationSchema),
  doctorQuestion: z.string().optional(),
});

export type QuestionResponse = z.infer<typeof QuestionResponseSchema>;

export const CaseStateSchema = z.enum([
  "DRAFT",
  "UPLOADED",
  "EXTRACTING",
  "NEEDS_REVIEW",
  "CONFIRMED",
  "VERIFIED",
  "READY",
  "EXTRACTION_FAILED",
  "SAFETY_FAILED",
  "DELETED",
]);

export type CaseState = z.infer<typeof CaseStateSchema>;

export type CaseView = {
  id: string;
  state: CaseState;
  intake: Omit<Intake, "preferredName">;
  preferredName: string;
  facts: Fact[];
  analysis: Analysis | null;
  providerMode: "demo" | "live";
  createdAt: string;
  expiresAt: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
};
