import "server-only";

import path from "node:path";

const defaultDataDirectory = path.join(process.cwd(), ".data");

export function getDataDirectory() {
  const configured = process.env.VERA_DATA_DIR?.trim();
  if (!configured) return defaultDataDirectory;
  return path.resolve(/* turbopackIgnore: true */ configured);
}
