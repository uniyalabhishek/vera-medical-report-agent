import { describe, expect, it } from "vitest";
import {
  extractStandaloneNumericClaims,
  findUngroundedNumericClaims,
  normalizeOptionalExtractedText,
  sourceContainsLiteral,
  sourceFieldsShareWindow,
} from "@/lib/source-binding";

describe("sourceContainsLiteral", () => {
  it("accepts complete medical fields across harmless spacing and dash differences", () => {
    const source = "HbA1c  8.2 %\nReference range: 4.0 – 5.6";

    expect(sourceContainsLiteral(source, "HbA1c")).toBe(true);
    expect(sourceContainsLiteral(source, "8.2")).toBe(true);
    expect(sourceContainsLiteral(source, "%")).toBe(true);
    expect(sourceContainsLiteral(source, "4.0-5.6")).toBe(true);
  });

  it("allows values and units that touch without accepting partial words", () => {
    expect(sourceContainsLiteral("Dose: 5mg", "5")).toBe(true);
    expect(sourceContainsLiteral("Dose: 5mg", "mg")).toBe(true);
    expect(sourceContainsLiteral("Vitamin D3", "D3")).toBe(true);
    expect(sourceContainsLiteral("Vitamin D3", "D")).toBe(false);
  });

  it("rejects partial names, numbers, comparators, units, and dates", () => {
    const source = "HbA1c 185 mg/dL <5 on 2025-01-12";

    expect(sourceContainsLiteral(source, "A1c")).toBe(false);
    expect(sourceContainsLiteral(source, "85")).toBe(false);
    expect(sourceContainsLiteral(source, "85 mg/dL")).toBe(false);
    expect(sourceContainsLiteral(source, "5")).toBe(false);
    expect(sourceContainsLiteral(source, "<5")).toBe(true);
    expect(sourceContainsLiteral(source, "dL")).toBe(false);
    expect(sourceContainsLiteral(source, "01-12")).toBe(false);
  });

  it("accepts an empty optional field without inventing a source requirement", () => {
    expect(sourceContainsLiteral("METFORMIN 500 mg", "")).toBe(true);
  });
});

describe("extractStandaloneNumericClaims", () => {
  it("keeps complete values while ignoring digits inside medical names", () => {
    expect(extractStandaloneNumericClaims("HbA1c is 7.2% on 2026-08-08; range 4.0–5.6."))
      .toEqual(["7.2", "2026-08-08", "4.0–5.6"]);
  });
});

describe("findUngroundedNumericClaims", () => {
  it("accepts values from either report facts or explicit user context", () => {
    expect(findUngroundedNumericClaims(
      "At age 24, your HbA1c result is 9.4%.",
      ["HbA1c 9.4 %", "Age 24"],
    )).toEqual([]);
  });

  it("rejects a new value that appears in neither approved source", () => {
    expect(findUngroundedNumericClaims(
      "At age 25, your HbA1c result is 9.4%.",
      ["HbA1c 9.4 %", "Age 24"],
    )).toEqual(["25"]);
  });
});

describe("normalizeOptionalExtractedText", () => {
  it("turns model placeholder values into empty fields", () => {
    expect(normalizeOptionalExtractedText(" not specified ")).toBe("");
    expect(normalizeOptionalExtractedText("N/A")).toBe("");
    expect(normalizeOptionalExtractedText("unknown")).toBe("");
    expect(normalizeOptionalExtractedText("not stated")).toBe("");
    expect(normalizeOptionalExtractedText("-")).toBe("");
    expect(normalizeOptionalExtractedText(" 30 days ")).toBe("30 days");
  });
});

describe("sourceFieldsShareWindow", () => {
  it("accepts fields copied from one compact result row", () => {
    expect(sourceFieldsShareWindow(
      "HbA1c | 8.2 | % | 4.0 – 5.6",
      ["HbA1c", "8.2", "%", "4.0-5.6"],
      160,
    )).toBe(true);
  });

  it("rejects fields collected from distant unrelated rows", () => {
    const source = `HbA1c | 8.2 | %\n${"unrelated text ".repeat(30)}Haemoglobin | 11.4 | g/dL`;
    expect(sourceFieldsShareWindow(source, ["HbA1c", "11.4", "g/dL"], 240)).toBe(false);
  });
});
