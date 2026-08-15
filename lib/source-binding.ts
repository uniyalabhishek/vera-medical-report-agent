const EMPTY_EXTRACTED_VALUES = new Set([
  "not provided",
  "not specified",
  "n/a",
  "na",
  "none",
  "unknown",
  "not stated",
  "-",
]);

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2014\u2212]/g, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-IN");
}

function compact(value: string) {
  return normalized(value)
    .replace(/\s*([%+\-/<>=.≤≥])\s*/gu, "$1")
    .replace(/[^\p{L}\p{N}%+\-/<>=.≤≥]+/gu, " ")
    .trim();
}

function literalPositions(source: string, expected: string) {
  const positions: Array<{ start: number; end: number }> = [];
  if (!expected) return positions;

  let offset = 0;
  while (offset <= source.length - expected.length) {
    const index = source.indexOf(expected, offset);
    if (index === -1) break;

    const previous = index > 0 ? source[index - 1] : undefined;
    const next = index + expected.length < source.length
      ? source[index + expected.length]
      : undefined;
    const first = expected[0];
    const last = expected[expected.length - 1];
    const startsCleanly = isLetter(first)
      ? !isLetter(previous) && !isConnectedPunctuation(previous)
      : isNumber(first)
        ? !isLetter(previous) && !isNumber(previous) && !isConnectedPunctuation(previous)
        : true;
    const endsCleanly = isLetter(last)
      ? !isLetter(next) && !isNumber(next) && !isConnectedPunctuation(next)
      : isNumber(last)
        ? !isNumber(next) && (!isConnectedPunctuation(next) || next === "%")
        : true;

    if (startsCleanly && endsCleanly) {
      positions.push({ start: index, end: index + expected.length });
    }
    offset = index + 1;
  }
  return positions;
}

function isLetter(value: string | undefined) {
  return Boolean(value && /\p{L}/u.test(value));
}

function isNumber(value: string | undefined) {
  return Boolean(value && /\p{N}/u.test(value));
}

function isConnectedPunctuation(value: string | undefined) {
  return Boolean(value && /[%+\-/<>=.≤≥]/u.test(value));
}

/**
 * Checks that an extracted field occurs as a complete literal in its source.
 * Whitespace and common dash variants may differ, but embedded partial values
 * such as `85` in `185` or `5` in `<5` are rejected.
 */
export function sourceContainsLiteral(sourceText: string, extractedValue: string) {
  const source = compact(sourceText);
  const expected = compact(extractedValue);
  if (!expected) return true;
  return literalPositions(source, expected).length > 0;
}

/**
 * Requires all non-empty extracted fields to occur inside one short source
 * window. This rejects citations that collect unrelated values from distant
 * rows while still allowing harmless OCR spacing and punctuation changes.
 */
export function sourceFieldsShareWindow(
  sourceText: string,
  extractedValues: string[],
  maxWindowCharacters: number,
) {
  const source = compact(sourceText);
  const expected = extractedValues.map(compact).filter(Boolean);
  if (expected.length === 0) return true;

  const events = expected.flatMap((value, field) =>
    literalPositions(source, value).map((position) => ({ ...position, field }))
  ).sort((left, right) => left.start - right.start);
  if (new Set(events.map((event) => event.field)).size !== expected.length) return false;

  const counts = new Map<number, number>();
  let covered = 0;
  let left = 0;
  for (let right = 0; right < events.length; right += 1) {
    const event = events[right];
    const count = counts.get(event.field) ?? 0;
    counts.set(event.field, count + 1);
    if (count === 0) covered += 1;

    while (covered === expected.length) {
      const first = events[left];
      if (event.end - first.start <= maxWindowCharacters) return true;
      const firstCount = counts.get(first.field)! - 1;
      counts.set(first.field, firstCount);
      if (firstCount === 0) covered -= 1;
      left += 1;
    }
  }
  return false;
}

export function normalizeOptionalExtractedText(value: string) {
  const trimmed = value.trim();
  return EMPTY_EXTRACTED_VALUES.has(normalized(trimmed)) ? "" : trimmed;
}

/** Extracts complete standalone values, ranges, and ISO dates without treating
 * the `1` in a medical name such as HbA1c as a numeric claim. */
export function extractStandaloneNumericClaims(value: string) {
  return value.match(
    /(?<![\p{L}\p{N}])(?:\d{4}-\d{2}-\d{2}|[<>≤≥]?\s*[+-]?\d+(?:\.\d+)?(?:\s*[\u2010-\u2014-]\s*[+-]?\d+(?:\.\d+)?)?)(?![\p{L}\p{N}])/gu,
  )?.map((claim) => claim.trim()) ?? [];
}

/** Returns numeric claims that do not occur in any approved source text. */
export function findUngroundedNumericClaims(value: string, approvedSources: string[]) {
  return extractStandaloneNumericClaims(value).filter((claim) =>
    !approvedSources.some((source) => sourceContainsLiteral(source, claim))
  );
}
