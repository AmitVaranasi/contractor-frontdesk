import { ctoRunRepoChecks } from "@/lib/agents/cto";
import { assertTool } from "@/lib/agents/roles";
import { createTask, completeTask, logEvent } from "@/lib/storage/repo";
import { handle } from "@/lib/http";

export const maxDuration = 900;

export function POST() {
  return handle(async () => {
    assertTool("arun", "run_checks");
    const task = createTask({ contractorId: null, sender: "maya", recipient: "arun", taskType: "run_checks", requestedAction: "Run the test suite in the Celesto sandbox" });
    const r = await ctoRunRepoChecks();
    completeTask(task, r.status === "pass" ? "done" : "failed", `Sandbox repo checks: ${r.status}`, [r.evidenceId]);
    logEvent({
      contractorId: null,
      agent: "arun",
      type: "checks.completed",
      summary: `Repo checks in sandbox: ${r.status}${r.runs.length ? ` (${r.runs.map((x) => `${x.command}=${x.exitCode}`).join(", ")})` : ""}`,
      data: { evidenceId: r.evidenceId, speech: r.status === "pass" ? "The full test suite passes in a clean sandbox." : `Sandbox checks ${r.status}. Details are in the evidence log.` },
    });
    return r;
  });
}
