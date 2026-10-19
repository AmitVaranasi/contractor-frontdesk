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
  const computer = await Computer.create({ cpus: 2, memory: 2048 });
  const runs: SandboxRun[] = [];
  try {
    for (const c of commands) {
      const t0 = Date.now();
      const r = await computer.run(c.command, { timeout: c.timeoutSec ?? 120 });
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
