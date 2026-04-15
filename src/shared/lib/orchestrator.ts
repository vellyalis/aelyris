/**
 * Multi-agent orchestrator.
 * Launches multiple agents with different roles simultaneously
 * and coordinates their work on the same codebase.
 *
 * Roles:
 * - implementer: Writes code based on a spec
 * - tester: Writes and runs tests
 * - reviewer: Reviews code for quality and bugs
 * - documenter: Updates documentation
 */

export interface OrchestraRole {
  id: string;
  label: string;
  model: string;
  promptTemplate: string;
}

export const ORCHESTRA_ROLES: OrchestraRole[] = [
  {
    id: "implementer",
    label: "Implementer",
    model: "sonnet",
    promptTemplate: "Implement the following task:\n\n{task}\n\nFocus on writing clean, working code. Follow existing patterns in the codebase.",
  },
  {
    id: "tester",
    label: "Tester",
    model: "sonnet",
    promptTemplate: "Write comprehensive tests for the following task:\n\n{task}\n\nCover happy path, edge cases, and error scenarios. Aim for 80%+ coverage.",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    model: "opus",
    promptTemplate: "Review the codebase for the following task:\n\n{task}\n\nCheck for bugs, security issues, performance problems, and code quality. Report findings.",
  },
  {
    id: "documenter",
    label: "Documenter",
    model: "haiku",
    promptTemplate: "Update documentation for the following task:\n\n{task}\n\nUpdate README, add inline comments where needed, and create usage examples.",
  },
];

export interface OrchestraConfig {
  task: string;
  roles: string[];
  projectPath: string;
}

/**
 * Build prompts for each selected role.
 */
export function buildOrchestraPrompts(config: OrchestraConfig): { roleId: string; model: string; prompt: string }[] {
  return config.roles
    .map((roleId) => {
      const role = ORCHESTRA_ROLES.find((r) => r.id === roleId);
      if (!role) return null;
      return {
        roleId: role.id,
        model: role.model,
        prompt: role.promptTemplate.replace("{task}", config.task),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}
