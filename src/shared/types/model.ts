export type ModelProvider = "claude" | "codex" | "gemini";

export interface ModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
  cliCommand: string;
  modelArg: string;
  color: string;
  /** Maximum context window size in tokens */
  maxTokens: number;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "claude-opus",
    label: "Claude Opus",
    provider: "claude",
    cliCommand: "claude",
    modelArg: "opus",
    color: "var(--ctp-mauve)",
    maxTokens: 200_000,
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet",
    provider: "claude",
    cliCommand: "claude",
    modelArg: "sonnet",
    color: "var(--ctp-blue)",
    maxTokens: 200_000,
  },
  {
    id: "claude-haiku",
    label: "Claude Haiku",
    provider: "claude",
    cliCommand: "claude",
    modelArg: "haiku",
    color: "var(--ctp-cyan)",
    maxTokens: 200_000,
  },
  {
    id: "codex",
    label: "Codex",
    provider: "codex",
    cliCommand: "codex",
    modelArg: "codex-mini",
    color: "var(--ctp-green)",
    maxTokens: 192_000,
  },
  {
    id: "gemini",
    label: "Gemini",
    provider: "gemini",
    cliCommand: "gemini",
    modelArg: "gemini-2.5-pro",
    color: "var(--ctp-yellow)",
    maxTokens: 1_000_000,
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet";

export function getModelById(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((m) => m.id === id);
}

export function getModelBySpecifier(specifier: string): ModelOption | undefined {
  const normalized = specifier.toLowerCase();
  return MODEL_OPTIONS.find(
    (m) => m.id === specifier || m.modelArg === specifier || m.label.toLowerCase() === normalized,
  );
}

/** Get max tokens for a model, with fallback for unknown models */
export function getMaxTokens(modelId: string): number {
  return getModelBySpecifier(modelId)?.maxTokens ?? 200_000;
}
