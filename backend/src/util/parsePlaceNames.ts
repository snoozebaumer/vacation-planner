export function parsePlaceNames(raw: string): string[] {
  const names = raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set(names));
}
