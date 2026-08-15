import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExplanationStep } from "@/components/explanation-step";
import type { Analysis, Fact, QuestionResponse } from "@/lib/contracts";

const source = {
  id: "span-1",
  documentId: "document-1",
  documentName: "private-report-name.pdf",
  page: 1,
  excerpt: "HbA1c 7.2 %",
  bbox: [0, 0, 1, 1] as [number, number, number, number],
  documentCategory: "report" as const,
};

const facts: Fact[] = [{
  id: "fact-1",
  kind: "observation",
  name: "HbA1c",
  value: "7.2",
  unit: "%",
  referenceRange: "4.0–5.6",
  numericRange: { kind: "closed", lower: 4, upper: 5.6 },
  flag: "high",
  effectiveDate: "2026-08-08",
  confirmed: true,
  needsReview: false,
  source,
}];

const analysis: Analysis = {
  providerMode: "demo",
  checkedDocumentCount: 1,
  generatedAt: "2026-08-16T00:00:00.000Z",
  cards: [
    { id: "documents", title: "Files", body: "One blood report.", citations: [{ sourceSpanId: source.id, label: "Private report · page 1" }] },
    { id: "findings", title: "Result", body: "HbA1c is above the printed range.", citations: [{ sourceSpanId: source.id, label: "Private report · page 1" }] },
    { id: "changes", title: "Change", body: "No comparable earlier result.", citations: [] },
    { id: "instructions", title: "Prescription", body: "No current prescription.", citations: [] },
    { id: "questions", title: "Ask", body: "Ask your doctor about this result.", citations: [] },
  ],
  suggestedQuestions: ["What does this result mean?", "What can I ask my doctor?"],
};

const commonProps = {
  analysis,
  facts,
  busy: false,
  caseId: "case-1",
  error: null,
  language: "English" as const,
  speechInputEnabled: false,
  speechOutputEnabled: false,
  onBackToSummary: vi.fn(),
  onOpenQuestions: vi.fn(),
  onStartOver: vi.fn(async () => undefined),
};

describe("patient-facing source controls", () => {
  it("keeps citations in data without showing source controls on the summary", () => {
    render(
      <ExplanationStep
        {...commonProps}
        onAsk={vi.fn()}
        view="summary"
      />,
    );

    expect(screen.getByText("HbA1c")).toBeInTheDocument();
    expect(screen.getByText("See picture explanation")).toBeVisible();
    expect(screen.queryByText(/see source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private-report-name/iu)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /source/i })).not.toBeInTheDocument();
  });

  it("keeps answer citations hidden from the question screen", async () => {
    const response: QuestionResponse = {
      answerType: "document_fact",
      answer: "The report records HbA1c as 7.2%.",
      citations: [{ sourceSpanId: source.id, label: "Private report · page 1" }],
      doctorQuestion: "What should I know about this result?",
    };
    render(
      <ExplanationStep
        {...commonProps}
        onAsk={vi.fn(async () => response)}
        view="questions"
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /your question/i }), {
      target: { value: "What is my HbA1c?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    expect(await screen.findByText(response.answer)).toBeInTheDocument();
    expect(screen.queryByText(/see source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private report/iu)).not.toBeInTheDocument();
  });
});
