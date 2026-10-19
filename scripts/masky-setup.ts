/**
 * Create the five agent avatars on Masky (portrait + personality + voice).
 *   npm run masky:setup
 * Needs MASKY_API_KEY. Prints the MASKY_AVATAR_* lines for .env.local.
 * Cost: 5 images at $0.005 each, or free with --own-images (uses public/agents/*.png).
 */
import { AGENT_ORDER, ROLES } from "../lib/agents/roles";

const BASE = "https://masky.ai/api";
const LOOKS: Record<string, { prompt: string; voice: string }> = {
  maya: { prompt: "friendly professional woman CEO in her 40s, short dark bob, purple blazer", voice: "Inspiring Woman" },
  leo: { prompt: "practical man COO in his 30s, short hair, teal work shirt, clipboard", voice: "Leo" },
  nia: { prompt: "sharp Black woman CFO in her 30s, natural curly hair, green blouse, glasses pushed up", voice: "Imani Carter" },
  arun: { prompt: "thoughtful South Asian man CTO in his 30s, round glasses, orange hoodie", voice: "Arjun" },
  sam: { prompt: "cheerful young receptionist with a headset, blue polo shirt, front-desk setting", voice: "Warm Female Assistant Voice" },
};

async function masky<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.MASKY_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Masky ${method} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function main() {
  if (!process.env.MASKY_API_KEY) {
    console.error("Set MASKY_API_KEY in .env.local (get one at https://masky.ai/developer).");
    process.exit(1);
  }
  const { voices } = await masky<{ voices: Array<{ id: string; name: string }> }>("GET", "/voices");
  const used = new Set<string>();
  const { avatars: existing } = await masky<{ avatars: Array<{ avatarId: string; avatarOwnerUserId: string; displayName: string }> }>("GET", "/avatars");
  const lines: string[] = [];
  for (const id of AGENT_ORDER) {
    const role = ROLES[id];
    const look = LOOKS[id];
    // Re-running the script reuses avatars it already created instead of paying for new ones.
    const already = existing.find((a) => a.displayName === `${role.name} (${role.title})`);
    if (already) {
      console.log(`= ${role.name}: reusing avatar ${already.avatarId}`);
      lines.push(`MASKY_AVATAR_${id.toUpperCase()}=${already.avatarOwnerUserId}:${already.avatarId}`);
      continue;
    }
    const voice = voices.find((v) => v.name === look.voice) ?? voices.find((v) => !used.has(v.id));
    if (!voice) throw new Error("No voices available");
    used.add(voice.id);
    // --own-images reuses the app's portraits (served via PUBLIC_BASE_URL) instead of paid generation.
    const imageUrl = process.argv.includes("--own-images")
      ? `${process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")}/agents/${id}.png`
      : (
          await masky<{ imageUrl: string }>("POST", "/images/generate", {
            prompt: `Flat illustrated avatar portrait, friendly, clean pastel background, ${look.prompt}`,
            aspectRatio: "1:1",
            model: "default",
          })
        ).imageUrl;
    const { avatar } = await masky<{ avatar: { avatarId: string; avatarOwnerUserId: string } }>("POST", "/avatars", {
      displayName: `${role.name} (${role.title})`,
      imageUrl,
      personalityPrompt: `${role.system} Character: ${role.character}.`,
      voiceId: voice.id,
    });
    console.log(`✓ ${role.name}: avatar ${avatar.avatarId}, voice "${voice.name}"`);
    lines.push(`MASKY_AVATAR_${id.toUpperCase()}=${avatar.avatarOwnerUserId}:${avatar.avatarId}`);
  }
  if (process.argv.includes("--write")) {
    const fs = await import("node:fs");
    let env = fs.readFileSync(".env.local", "utf8");
    for (const line of lines) {
      const key = line.split("=")[0];
      env = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${env}\n${line}`;
    }
    fs.writeFileSync(".env.local", env);
    console.log("\n✓ Wrote MASKY_AVATAR_* to .env.local");
  } else {
    console.log(`\nAdd to .env.local:\n${lines.join("\n")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
