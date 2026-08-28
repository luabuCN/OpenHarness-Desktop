export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolset: "all" | "readonly";
  withExploreSubagent: boolean;
}

export const DEFAULT_AGENT_ID = "default";

const baseInstructions =
  "You are a local coding assistant working inside the user's workspace. " +
  "Be concise and direct. Use announce before multi-step work or when you find " +
  "something notable. Do not claim to have changed files unless a tool call succeeded.";

export const agentDefinitions: AgentDefinition[] = [
  {
    id: "default",
    name: "Default Agent",
    description: "General-purpose local workspace assistant with the full toolset.",
    instructions: baseInstructions,
    toolset: "all",
    withExploreSubagent: true,
  },
  {
    id: "explore",
    name: "Explore Agent",
    description:
      "Read-only exploration specialist. Finds files, searches code, and reports concise findings without modifying anything.",
    instructions:
      `${baseInstructions} You are read-only: explore the workspace, read files, and search ` +
      "code, then report concise findings. Never modify files or run mutating commands.",
    toolset: "readonly",
    withExploreSubagent: false,
  },
  {
    id: "code",
    name: "Code Agent",
    description: "Implementation specialist focused on making and verifying code changes.",
    instructions:
      `${baseInstructions} You focus on implementing the requested change end to end: ` +
      "locate the right files, make the edits, and verify with tests or builds when available.",
    toolset: "all",
    withExploreSubagent: true,
  },
];

export function resolveAgentDefinition(id?: string): AgentDefinition {
  return agentDefinitions.find((agent) => agent.id === id) ?? agentDefinitions[0];
}
