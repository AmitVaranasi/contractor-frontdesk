import { z } from "zod";
import { turnMedia } from "@/lib/adapters/masky";
import { createCallRecap } from "@/lib/phone/recap";
import { getCall } from "@/lib/phone/calls";
import { handle, HttpError, parseBody } from "@/lib/http";

/** Fresh signed media URL for a call's Masky recap (stored URLs expire after ~1 hour). */
export function GET(req: Request) {
  return handle(async () => {
    const call = getCall(new URL(req.url).searchParams.get("id") ?? "");
    if (!call) throw new HttpError(404, "Call not found");
    if (!call.recap_turn_id) return { status: call.recap_status ?? null, text: call.recap_text ?? null };
    const media = await turnMedia("sam", call.recap_turn_id);
    return { status: call.recap_status, text: call.recap_text, videoUrl: media?.videoUrl ?? null, audioUrl: media?.audioUrl ?? null, liveUrl: call.recap_live_url ?? media?.liveUrl ?? null };
  });
}

/** (Re)create a recap, e.g. for calls made before recaps existed. */
export function POST(req: Request) {
  return handle(async () => {
    const { id } = await parseBody(req, z.object({ id: z.string() }));
    const call = getCall(id);
    if (!call) throw new HttpError(404, "Call not found");
    if (call.recap_status?.startsWith("failed")) {
      const { getDb } = await import("@/lib/storage/db");
      getDb().prepare("UPDATE calls SET recap_status = NULL WHERE id = ?").run(id);
    }
    void createCallRecap(id);
    return { ok: true };
  });
}
