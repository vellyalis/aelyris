export interface WorkflowStep {
  name: string;
  prompt: string;
  model?: string;
  watchdogPreset?: "permissive" | "strict" | "readonly";
  qualityGate?: {
    command: string;
    successPattern: string;
  };
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export const DEFAULT_WORKFLOWS: Workflow[] = [
  {
    id: "implement-feature",
    name: "Implement Feature",
    description: "Plan → Code → Test → Review",
    steps: [
      { name: "Plan", prompt: "Plan the implementation for: {{task}}", model: "claude-opus", watchdogPreset: "strict" },
      {
        name: "Implement",
        prompt: "Implement the plan from the previous step",
        model: "claude-sonnet",
        watchdogPreset: "permissive",
      },
      {
        name: "Test",
        prompt: "Write tests for the implementation",
        model: "claude-sonnet",
        watchdogPreset: "permissive",
        qualityGate: { command: "pnpm test", successPattern: "passed" },
      },
      {
        name: "Review",
        prompt: "Review the code changes for quality and security issues",
        model: "claude-opus",
        watchdogPreset: "readonly",
      },
    ],
  },
  {
    id: "fix-bug",
    name: "Fix Bug",
    description: "Investigate → Fix → Verify",
    steps: [
      {
        name: "Investigate",
        prompt: "Investigate the bug: {{task}}",
        model: "claude-sonnet",
        watchdogPreset: "strict",
      },
      {
        name: "Fix",
        prompt: "Fix the bug based on the investigation",
        model: "claude-sonnet",
        watchdogPreset: "permissive",
      },
      {
        name: "Verify",
        prompt: "Verify the fix by running tests",
        model: "claude-haiku",
        watchdogPreset: "permissive",
        qualityGate: { command: "pnpm test", successPattern: "passed" },
      },
    ],
  },
];
