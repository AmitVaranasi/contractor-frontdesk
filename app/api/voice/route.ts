import { z } from "zod";
import { maskyConfigured, speak } from "@/lib/adapters/masky";
import { recordUsage } from "@/lib/storage/repo";
import { handle, parseBody } from "@/lib/http";

export const maxDuration = 120;

export function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(
      req,
      z.object({ agent: z.enum(["maya", "leo", "nia", "arun", "sam"]), text: z.string().min(1).max(500), contractorId: z.string().nullable().optional(), output: z.enum(["audio", "video"]).optional() }),
    );
    if (!maskyConfigured(body.agent)) {
      recordUsage({ contractorId: body.contractorId ?? null, agent: body.agent, provider: "browser-tts", kind: "speech_seconds", quantity: body.text.length / 15, unit: "seconds", costUsd: 0, costBasis: "estimated", live: false });
      return { engine: "browser", audioUrl: null, videoUrl: null };
    }
    try {
      const media = await speak(body.agent, body.text, body.output ?? "audio", body.contractorId ?? null);
      return { engine: "masky", ...media };
    } catch (err) {
      return { engine: "browser", audioUrl: null, videoUrl: null, error: (err as Error).message };
    }
  });
}
