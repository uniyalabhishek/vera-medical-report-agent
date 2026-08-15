import { describe, expect, it } from "vitest";
import { demoProvider } from "@/lib/model/demo-provider";

const intake = {
  age: 18,
  language: "English" as const,
  documentLanguage: "English" as const,
  symptoms: "",
  medicalHistory: "",
};

describe("DemoMedicalReportProvider", () => {
  it("extracts a fixed, source-linked synthetic case", async () => {
    const facts = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });

    expect(facts).toHaveLength(4);
    expect(facts.every((fact) => fact.confirmed && !fact.needsReview)).toBe(true);
    expect(facts.every((fact) => fact.source.page > 0 && fact.source.excerpt.length > 0)).toBe(true);
    expect(facts.find((fact) => fact.id === "fact_hba1c_current")).toMatchObject({
      numericRange: { kind: "closed", lower: 4, upper: 5.6 },
    });
  });

  it("does not pretend to extract an uploaded document", async () => {
    await expect(
      demoProvider.extract({ caseId: "case", intake, mode: "uploaded", documents: [] }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIGURATION_REQUIRED" });
  });

  it("blocks synthesis when a fact is not accepted by the server", async () => {
    const facts = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });

    await expect(
      demoProvider.synthesize({
        caseId: "case",
        intake,
        facts: facts.map((fact, index) => index === 0 ? { ...fact, needsReview: true } : fact),
      }),
    ).rejects.toThrow("accepted");
  });

  it("creates exactly five source-linked explanation sections", async () => {
    const extracted = await demoProvider.extract({ caseId: "case", intake, mode: "demo", documents: [] });
    const analysis = await demoProvider.synthesize({ caseId: "case", intake, facts: extracted });

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
    const facts = extracted;
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
    const facts = extracted;
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

  it.each(["Hindi", "Tamil", "Kannada", "Marathi"] as const)(
    "localizes the complete sample explanation in %s while preserving values",
    async (language) => {
      const localizedIntake = { ...intake, language };
      const facts = await demoProvider.extract({
        caseId: "case",
        intake: localizedIntake,
        mode: "demo",
        documents: [],
      });
      const analysis = await demoProvider.synthesize({
        caseId: "case",
        intake: localizedIntake,
        facts,
      });

      expect(analysis.cards).toHaveLength(5);
      expect(analysis.cards[0].title).not.toBe("1. What these files contain");
      expect(analysis.cards[1].body).toContain("7.2%");
      expect(analysis.cards[1].body).toContain("11.4 g/dL");
    },
  );
});
