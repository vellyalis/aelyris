export type ModelProvider = "claude" | "codex" | "gemini";

export interface ModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
  cliCommand: string;
  modelArg: string;
  color: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-opus", label: "Claude Opus", provider: "claude", cliCommand: "claude", modelArg: "opus", color: "#cba6f7" },
  { id: "claude-sonnet", label: "Claude Sonnet", provider: "claude", cliCommand: "claude", modelArg: "sonnet", color: "#89b4fa" },
  { id: "claude-haiku", label: "Claude Haiku", provider: "claude", cliCommand: "claude", modelArg: "haiku", color: "#94e2d5" },
  { id: "codex", label: "Codex", provider: "codex", cliCommand: "codex", modelArg: "codex-mini", color: "#a6e3a1" },
  { id: "gemini", label: "Gemini", provider: "gemini", cliCommand: "gemini", modelArg: "gemini-2.5-pro", color: "#f9e2af" },
];

export const DEFAULT_MODEL_ID = "claude-sonnet";

export function getModelById(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((m) => m.id === id);
}
