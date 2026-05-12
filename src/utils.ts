/** Claude の tool_use レスポンスが配列 / JSON文字列 / 単一文字列 のいずれでも配列に変換 */
export function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // fall through
      }
    }
    return trimmed ? [trimmed] : [];
  }
  return [];
}
