import { describe, expect, it } from "vitest";
import { demoProvider } from "@/lib/model/demo-provider";

const intake = {
  age: 42,
  language: "English" as const,
  symptoms: "",
  medicalHistory: "",
};

describe("DemoMedicalReportProvider", () => {
  it("extracts a fixed, source-linked synthetic case", async () => {
    const facts = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });

    expect(facts).toHaveLength(4);
    expect(facts.every((fact) => fact.confirmed === false)).toBe(true);
    expect(facts.every((fact) => fact.source.page > 0 && fact.source.excerpt.length > 0)).toBe(true);
  });

  it("does not pretend to extract an uploaded document", async () => {
    await expect(
      demoProvider.extract({ caseId: "case", intake, mode: "uploaded", documents: [] }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIGURATION_REQUIRED" });
  });

  it("blocks synthesis until every fact is confirmed", async () => {
    const facts = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });

    await expect(
      demoProvider.synthesize({ caseId: "case", intake, facts }),
    ).rejects.toThrow("confirmed");
  });

  it("creates exactly five source-linked explanation sections", async () => {
    const extracted = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });
    const facts = extracted.map((fact) => ({ ...fact, confirmed: true }));
    const analysis = await demoProvider.synthesize({ caseId: "case", intake, facts });

    expect(analysis.cards.map((card) => card.id)).toEqual([
      "documents",
      "findings",
      "changes",
      "instructions",
      "questions",
    ]);
    expect(
      analysis.cards
        .filter((card) => card.id !== "questions")
        .every((card) => card.citations.length > 0),
    ).toBe(true);
  });

  it("refuses medication-change questions and repeats only the source instruction", async () => {
    const extracted = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });
    const facts = extracted.map((fact) => ({ ...fact, confirmed: true }));
    const analysis = await demoProvider.synthesize({ caseId: "case", intake, facts });
    const answer = await demoProvider.answer({
      caseId: "case",
      intake,
      facts,
      analysis,
      question: "Should I stop this medicine?",
    });

    expect(answer.answerType).toBe("boundary");
    expect(answer.answer).toContain("cannot tell you to change or stop");
    expect(answer.citations).toHaveLength(1);
  });

  it("answers a haemoglobin question from the haemoglobin fact", async () => {
    const extracted = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });
    const facts = extracted.map((fact) => ({ ...fact, confirmed: true }));
    const analysis = await demoProvider.synthesize({ caseId: "case", intake, facts });
    const answer = await demoProvider.answer({
      caseId: "case",
      intake,
      facts,
      analysis,
      question: "Why is my haemoglobin low?",
    });

    expect(answer.answerType).toBe("cannot_determine");
    expect(answer.answer).toContain("11.4 g/dL");
    expect(answer.answer).not.toContain("HbA1c");
    expect(answer.citations).toHaveLength(1);
  });
});
