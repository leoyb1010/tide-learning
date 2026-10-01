/** Accept only unambiguous same-origin absolute paths. Browsers normalize
 * backslashes and strip control characters before resolving a URL. */
export function safeInternalPath(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20\x7f]/.test(value)) return fallback;
  try {
    const base = "https://tide.invalid";
    const parsed = new URL(value, base);
    return parsed.origin === base ? value : fallback;
  } catch {
    return fallback;
  }
}
