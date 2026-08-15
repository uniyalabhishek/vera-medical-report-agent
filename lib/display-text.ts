const SOURCE_SPAN_ID = /span_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i;

export function cleanDisplayText(value: string) {
  return value
    .replace(SOURCE_SPAN_ID, "")
    .replace(/\[\s*(?:,\s*)*\]/g, "")
    .replace(/\(\s*(?:,\s*)*\)/g, "")
    .replace(/\*{1,3}/g, "")
    .replace(/\s+([,.;:!?।])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function cleanCitationLabel(value: string) {
  const [rawName, ...locationParts] = value.split(/\s+·\s+/);
  const readableName = rawName
    .replace(UUID_PREFIX, "")
    .replace(/^[a-z]{1,5}-\d+_{1,2}/i, "")
    .replace(/\.(?:pdf|png|jpe?g)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const shortName = readableName.length > 48
    ? `${readableName.slice(0, 45).trimEnd()}…`
    : readableName;
  return [shortName || "Uploaded report", ...locationParts].join(" · ");
}
