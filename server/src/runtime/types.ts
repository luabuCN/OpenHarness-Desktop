export const THINKING_MODES = ["fast", "deep"] as const;

export type ThinkingMode = (typeof THINKING_MODES)[number];

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === "string" && THINKING_MODES.includes(value as ThinkingMode);
}

export interface AgentProfile {
  id: ThinkingMode;
  label: string;
  enableThinking: boolean;
}

export const agentProfiles: Record<ThinkingMode, AgentProfile> = {
  fast: {
    id: "fast",
    label: "Speed thinking",
    enableThinking: false,
  },
  deep: {
    id: "deep",
    label: "Deep thinking",
    enableThinking: true,
  },
};
