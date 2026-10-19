import { z } from "zod";
import { BookingError } from "./booking";
import { PermissionDenied } from "./agents/roles";

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Map known errors to safe responses; never leak stack traces or provider errors with secrets. */
export function handle(fn: () => Promise<unknown>) {
  return fn()
    .then((data) => Response.json(data))
    .catch((err: unknown) => {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof BookingError) return Response.json({ error: err.message, code: err.code }, { status: 409 });
      if (err instanceof PermissionDenied) return Response.json({ error: err.message, code: "PERMISSION_DENIED" }, { status: 403 });
      console.error("[api]", err);
      return Response.json({ error: (err as Error).message?.slice(0, 200) ?? "Internal error" }, { status: 500 });
    });
}
