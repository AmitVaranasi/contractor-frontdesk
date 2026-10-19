import crypto from "node:crypto";
import { Computer } from "@celestoai/sdk";
import { recordUsage } from "../storage/repo";

export function celestoConfigured(): boolean {
  return Boolean(process.env.CELESTO_API_KEY);
}

export interface SandboxRun {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Create one isolated computer, run allowlisted commands, capture results, and
 * always delete the machine. Five agents share one sandbox per check run.
 */
export async function runInSandbox(commands: Array<{ label: string; command: string; timeoutSec?: number }>, contractorId: string | null): Promise<SandboxRun[]> {
  const started = Date.now();
  // Named template with its default size (the API rejects CPU/RAM overrides). It ships git, python and node.
  // The API also requires an Idempotency-Key on creation, which SDK 0.1.6 does not send itself.
  const computer = await Computer.create(
    { templateId: process.env.CELESTO_TEMPLATE ?? "coding-agent" },
    { headers: { "Idempotency-Key": crypto.randomUUID() } },
  );
  const runs: SandboxRun[] = [];
  try {
    // Creation returns while the VM is still booting; commands fail until it is running.
    for (let waited = 0; computer.status !== "running"; waited += 2000) {
      if (computer.status === "error") throw new Error(`Sandbox failed to start: ${computer.lastError ?? "unknown"}`);
      if (waited > 180_000) throw new Error(`Sandbox still ${computer.status} after 3 minutes`);
      await new Promise((r) => setTimeout(r, 2000));
      await computer.refresh();
    }
    for (const c of commands) {
      const t0 = Date.now();
      // Celesto rejects command timeouts above 300 seconds.
      const r = await computer.run(c.command, { timeout: Math.min(c.timeoutSec ?? 120, 300) });
      runs.push({ command: c.label, exitCode: r.exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "", durationMs: Date.now() - t0 });
      if (r.exitCode !== 0) break;
    }
  } finally {
    await computer.delete().catch(() => undefined);
    const minutes = (Date.now() - started) / 60_000;
    recordUsage({
      contractorId,
      agent: "arun",
      provider: "celesto",
      kind: "sandbox_minutes",
      quantity: minutes,
      unit: "minutes",
      // Placeholder rate until the account's compute price is confirmed.
      costUsd: minutes * Number(process.env.CELESTO_USD_PER_MINUTE ?? 0.002),
      costBasis: "estimated",
      live: true,
    });
  }
  return runs;
}
