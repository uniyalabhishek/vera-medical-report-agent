import { describe, expect, it } from "vitest";
import type { Fact, ObservationFact } from "@/lib/contracts";
import { buildVisualSpec, selectVisualObservation } from "@/lib/visual-explanation";

function observation(overrides: Partial<ObservationFact> = {}): ObservationFact {
  return {
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
    source: {
      id: "span-1",
      documentId: "document-1",
      documentName: "report.pdf",
      page: 1,
      excerpt: "HbA1c 7.2 %",
      bbox: [0, 0, 1, 1],
      documentCategory: "report",
    },
    ...overrides,
  };
}

describe("visual explanation planning", () => {
  it("chooses the latest result even when an older result was out of range", () => {
    const facts: Fact[] = [
      observation({ id: "normal", flag: "normal", effectiveDate: "2026-08-10" }),
      observation({ id: "outside", flag: "low", effectiveDate: "2026-08-08" }),
    ];

    expect(selectVisualObservation(facts)?.id).toBe("normal");
  });

  it("chooses an out-of-range result when dates are the same", () => {
    const facts: Fact[] = [
      observation({ id: "normal", flag: "normal" }),
      observation({ id: "outside", flag: "low" }),
    ];

    expect(selectVisualObservation(facts)?.id).toBe("outside");
  });

  it("does not use an unconfirmed or review-needed result", () => {
    const facts: Fact[] = [
      observation({ id: "review", needsReview: true }),
      observation({ id: "accepted", name: "Haemoglobin", flag: "low" }),
    ];

    expect(selectVisualObservation(facts)?.id).toBe("accepted");
  });

  it("maps HbA1c to physiology instead of a damaged organ", () => {
    const spec = buildVisualSpec(observation());

    expect(spec.concept).toBe("average-blood-glucose");
    expect(spec.scene).toContain("red blood cells");
    expect(spec.scene).not.toMatch(/pancreas|damage|disease/iu);
  });

  it("uses a neutral blood-test scene for an unknown marker", () => {
    const spec = buildVisualSpec(observation({ name: "Unmapped marker" }));

    expect(spec.concept).toBe("blood-marker");
    expect(spec.scene).toContain("general blood-test concept");
  });

  it("does not mistake letters inside fasting for the liver marker AST", () => {
    const spec = buildVisualSpec(observation({ name: "Fasting insulin" }));

    expect(spec.concept).toBe("blood-marker");
  });
});
