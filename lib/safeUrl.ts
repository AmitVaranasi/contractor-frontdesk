/** Only http(s) URLs and bundled demo pages may become links; blocks javascript:, data: and similar. */
export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (/^\/demo-sites\/[\w.-]+\.html$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
