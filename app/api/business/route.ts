import { answersSchema, createBusiness } from "@/lib/agents/newBusiness";
import { runOnboarding } from "@/lib/agents/onboarding";
import { handle, parseBody } from "@/lib/http";

export const maxDuration = 300;

/** Owner submits "Add your business": Leo builds the price list, then the full agent onboarding runs. */
export function POST(req: Request) {
  return handle(async () => {
    const answers = await parseBody(req, answersSchema);
    const created = await createBusiness(answers);
    const onboarding = await runOnboarding(created.contractorId);
    return { ...created, onboarding };
  });
}
