import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

/**
 * Fetch a contractor web page for COO research. Public http(s) only: private,
 * loopback and link-local destinations are refused to prevent SSRF. The bundled
 * fictional demo sites under /demo-sites/ are read from disk and labelled.
 */

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  hiddenText: string;
  origin: "demo-fixture" | "public-web";
  fetchedAt: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addrs.length === 0 || addrs.some(isPrivateIp)) throw new Error("Destination resolves to a private or local address");
  return url;
}

function htmlToText(html: string) {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const hidden: string[] = [];
  const withoutHidden = html.replace(/<([a-z]+)[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => {
    hidden.push(inner.replace(/<[^>]+>/g, " "));
    return " ";
  });
  const text = withoutHidden
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
    .replace(/<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  return { title, text, hiddenText: hidden.join(" ").replace(/\s+/g, " ").trim() };
}

export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  const fetchedAt = new Date().toISOString();
  if (rawUrl.startsWith("/demo-sites/")) {
    const file = path.join(process.cwd(), "public", path.normalize(rawUrl).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(path.join(process.cwd(), "public", "demo-sites"))) throw new Error("Invalid demo path");
    const html = await fs.readFile(file, "utf8");
    return { url: rawUrl, origin: "demo-fixture", fetchedAt, ...htmlToText(html) };
  }

  let url = await assertPublicUrl(rawUrl);
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "FrontDeskResearch/0.1" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = (await res.text()).slice(0, 300_000);
    return { url: url.toString(), origin: "public-web", fetchedAt, ...htmlToText(html) };
  }
  throw new Error("Too many redirects");
}

/** Phrases that try to instruct the agent. Flagged, never followed. */
export function detectInjection(text: string): string[] {
  const patterns = [/ignore (all |your )?(previous|prior) (rules|instructions)/i, /reveal .*(key|secret|password)/i, /AI assistant instructions/i, /system prompt/i];
  return patterns.filter((p) => p.test(text)).map((p) => p.source);
}
