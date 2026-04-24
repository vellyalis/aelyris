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

export type OrchestraRoleId = "implementer" | "tester" | "reviewer" | "documenter";

export interface OrchestraRole {
  id: OrchestraRoleId;
  label: string;
  model: string;
  promptTemplate: string;
  /** Short icon glyph for SessionCard badge — 1-2 chars, monospace-safe. */
  icon: string;
  /** Accent color for the role badge. */
  color: string;
}

export const ORCHESTRA_ROLES: OrchestraRole[] = [
  {
    id: "implementer",
    label: "Implementer",
    model: "sonnet",
    icon: "I",
    color: "#89b4fa",
    promptTemplate:
      "Implement the following task:\n\n{task}\n\nFocus on writing clean, working code. Follow existing patterns in the codebase.",
  },
  {
    id: "tester",
    label: "Tester",
    model: "sonnet",
    icon: "T",
    color: "#a6e3a1",
    promptTemplate:
      "Write comprehensive tests for the following task:\n\n{task}\n\nCover happy path, edge cases, and error scenarios. Aim for 80%+ coverage.",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    model: "opus",
    icon: "R",
    color: "#cba6f7",
    promptTemplate:
      "Review the codebase for the following task:\n\n{task}\n\nCheck for bugs, security issues, performance problems, and code quality. Report findings.",
  },
  {
    id: "documenter",
    label: "Documenter",
    model: "haiku",
    icon: "D",
    color: "#f9e2af",
    promptTemplate:
      "Update documentation for the following task:\n\n{task}\n\nUpdate README, add inline comments where needed, and create usage examples.",
  },
];

export function getRole(id: OrchestraRoleId | undefined | null): OrchestraRole | undefined {
  if (!id) return undefined;
  return ORCHESTRA_ROLES.find((r) => r.id === id);
}

/**
 * Collect file paths that were written to by more than one agent session.
 * Intended for the parallel view's conflict detection — the caller provides
 * the `changedFileDetails` arrays keyed by session id.
 */
export interface FileConflict {
  path: string;
  sessionIds: string[];
}

export function detectFileConflicts(
  sessions: ReadonlyArray<{ id: string; changedFileDetails?: ReadonlyArray<{ path: string }> }>,
): FileConflict[] {
  const byPath = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (!s.changedFileDetails) continue;
    for (const detail of s.changedFileDetails) {
      const set = byPath.get(detail.path) ?? new Set<string>();
      set.add(s.id);
      byPath.set(detail.path, set);
    }
  }
  const conflicts: FileConflict[] = [];
  for (const [path, ids] of byPath) {
    if (ids.size < 2) continue;
    conflicts.push({ path, sessionIds: [...ids].sort() });
  }
  conflicts.sort((a, b) => a.path.localeCompare(b.path));
  return conflicts;
}

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
