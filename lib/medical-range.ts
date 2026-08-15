const NUMBER_PATTERN = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const EXACT_NUMBER_PATTERN = new RegExp(`^${NUMBER_PATTERN}$`, "u");
const CLOSED_RANGE_PATTERN = new RegExp(
  `^(${NUMBER_PATTERN})\\s*[-\\u2010-\\u2014]\\s*(${NUMBER_PATTERN})$`,
  "u",
);
const INEQUALITY_PATTERN = new RegExp(`^(<=|>=|<|>|≤|≥)\\s*(${NUMBER_PATTERN})$`, "u");

export type ParsedMedicalRange =
  | {
      kind: "closed";
      lower: number;
      upper: number;
    }
  | {
      kind: "upper-bound";
      bound: number;
      inclusive: boolean;
    }
  | {
      kind: "lower-bound";
      bound: number;
      inclusive: boolean;
    };

export type MedicalRangePosition = "below" | "within" | "above";

function normalizePrintedValue(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\u2212/g, "-")
    .trim();
}

export function parseMedicalNumber(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const normalized = normalizePrintedValue(value);
  if (!EXACT_NUMBER_PATTERN.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMedicalRange(value: string): ParsedMedicalRange | null {
  const normalized = normalizePrintedValue(value);
  if (!normalized) return null;

  const inequality = normalized.match(INEQUALITY_PATTERN);
  if (inequality) {
    const operator = inequality[1];
    const bound = parseMedicalNumber(inequality[2]);
    if (bound === null) return null;

    if (operator === "<" || operator === "<=" || operator === "≤") {
      return {
        kind: "upper-bound",
        bound,
        inclusive: operator !== "<",
      };
    }

    return {
      kind: "lower-bound",
      bound,
      inclusive: operator !== ">",
    };
  }

  const closedRange = normalized.match(CLOSED_RANGE_PATTERN);
  if (!closedRange) return null;

  const lower = parseMedicalNumber(closedRange[1]);
  const upper = parseMedicalNumber(closedRange[2]);
  if (lower === null || upper === null || lower > upper) return null;

  return { kind: "closed", lower, upper };
}

export function classifyMedicalValue(
  measuredValue: string | number,
  printedRange: string,
): MedicalRangePosition | null {
  const measured = parseMedicalNumber(measuredValue);
  const range = parseMedicalRange(printedRange);
  if (measured === null || range === null) return null;

  if (range.kind === "closed") {
    if (measured < range.lower) return "below";
    if (measured > range.upper) return "above";
    return "within";
  }

  if (range.kind === "upper-bound") {
    const within = range.inclusive ? measured <= range.bound : measured < range.bound;
    return within ? "within" : "above";
  }

  const within = range.inclusive ? measured >= range.bound : measured > range.bound;
  return within ? "within" : "below";
}
