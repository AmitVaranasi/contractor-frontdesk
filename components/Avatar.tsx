import { ROLES } from "@/lib/agents/roles";
import type { AgentId } from "@/lib/types";

export function Avatar({ agent, size = 48, speaking = false }: { agent: AgentId; size?: number; speaking?: boolean }) {
  const role = ROLES[agent];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/agents/${agent}.svg`}
      alt={`${role.name}, ${role.title}`}
      width={size}
      height={size}
      className={`shrink-0 rounded-2xl ${speaking ? "ring-4 animate-pulse" : ""}`}
      style={speaking ? ({ "--tw-ring-color": role.color } as React.CSSProperties) : undefined}
    />
  );
}
