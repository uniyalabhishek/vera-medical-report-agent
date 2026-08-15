import { describe, expect, it } from "vitest";
import {
  classifyMedicalValue,
  parseMedicalNumber,
  parseMedicalRange,
} from "@/lib/medical-range";

describe("parseMedicalNumber", () => {
  it("accepts complete decimal and negative values", () => {
    expect(parseMedicalNumber("4.25")).toBe(4.25);
    expect(parseMedicalNumber(".75")).toBe(0.75);
    expect(parseMedicalNumber("−2.5")).toBe(-2.5);
    expect(parseMedicalNumber(-3)).toBe(-3);
  });

  it("rejects partial, non-finite, and ambiguous values", () => {
    expect(parseMedicalNumber("85 mg/dL")).toBeNull();
    expect(parseMedicalNumber("1,25")).toBeNull();
    expect(parseMedicalNumber("1e2")).toBeNull();
    expect(parseMedicalNumber(Number.NaN)).toBeNull();
    expect(parseMedicalNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("parseMedicalRange", () => {
  it("parses ASCII and Unicode closed ranges", () => {
    expect(parseMedicalRange("70-99")).toEqual({ kind: "closed", lower: 70, upper: 99 });
    expect(parseMedicalRange("4.0–5.6")).toEqual({ kind: "closed", lower: 4, upper: 5.6 });
    expect(parseMedicalRange(".5 — 1.25")).toEqual({ kind: "closed", lower: 0.5, upper: 1.25 });
    expect(parseMedicalRange("4.0−5.6")).toEqual({ kind: "closed", lower: 4, upper: 5.6 });
  });

  it("parses negative closed ranges without treating the separator as a sign", () => {
    expect(parseMedicalRange("-5--1")).toEqual({ kind: "closed", lower: -5, upper: -1 });
    expect(parseMedicalRange("-5 - -1")).toEqual({ kind: "closed", lower: -5, upper: -1 });
    expect(parseMedicalRange("−5–−1")).toEqual({ kind: "closed", lower: -5, upper: -1 });
    expect(parseMedicalRange("-5–1")).toEqual({ kind: "closed", lower: -5, upper: 1 });
  });

  it("parses strict and inclusive inequalities", () => {
    expect(parseMedicalRange("<5")).toEqual({ kind: "upper-bound", bound: 5, inclusive: false });
    expect(parseMedicalRange("<= 5.5")).toEqual({ kind: "upper-bound", bound: 5.5, inclusive: true });
    expect(parseMedicalRange("≤ 0.5")).toEqual({ kind: "upper-bound", bound: 0.5, inclusive: true });
    expect(parseMedicalRange("> -2")).toEqual({ kind: "lower-bound", bound: -2, inclusive: false });
    expect(parseMedicalRange(">=−2")).toEqual({ kind: "lower-bound", bound: -2, inclusive: true });
    expect(parseMedicalRange("≥ 3.0")).toEqual({ kind: "lower-bound", bound: 3, inclusive: true });
  });

  it.each([
    "",
    "N/A",
    "70 99",
    "70/99",
    "70 ± 5",
    "70-99-120",
    "99-70",
    "70 to 99",
    "70,5-99,5",
    "1e2-2e2",
    "< 5 > 2",
    "70-99 mg/dL",
  ])("rejects unsupported or ambiguous range %j", (range) => {
    expect(parseMedicalRange(range)).toBeNull();
  });
});

describe("classifyMedicalValue", () => {
  it("classifies closed ranges with inclusive endpoints", () => {
    expect(classifyMedicalValue("69.9", "70-99")).toBe("below");
    expect(classifyMedicalValue("70", "70-99")).toBe("within");
    expect(classifyMedicalValue("85", "70-99")).toBe("within");
    expect(classifyMedicalValue("99", "70-99")).toBe("within");
    expect(classifyMedicalValue("99.1", "70-99")).toBe("above");
    expect(classifyMedicalValue("-3", "-5--1")).toBe("within");
  });

  it("honors strict and inclusive inequality boundaries", () => {
    expect(classifyMedicalValue("4.9", "<5")).toBe("within");
    expect(classifyMedicalValue("5", "<5")).toBe("above");
    expect(classifyMedicalValue("5", "<=5")).toBe("within");
    expect(classifyMedicalValue("5.1", "≤5")).toBe("above");
    expect(classifyMedicalValue("5.1", ">5")).toBe("within");
    expect(classifyMedicalValue("5", ">5")).toBe("below");
    expect(classifyMedicalValue("5", ">=5")).toBe("within");
    expect(classifyMedicalValue("4.9", "≥5")).toBe("below");
  });

  it("returns null instead of inferring from invalid input", () => {
    expect(classifyMedicalValue("85 mg/dL", "70-99")).toBeNull();
    expect(classifyMedicalValue("85", "70 to 99")).toBeNull();
    expect(classifyMedicalValue("85", "70-99 mg/dL")).toBeNull();
    expect(classifyMedicalValue(Number.NaN, "70-99")).toBeNull();
  });
});
