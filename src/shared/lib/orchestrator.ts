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
export type OrchestraLaneId = "build" | "verify" | "review" | "docs";

export interface OrchestraRole {
  id: OrchestraRoleId;
  label: string;
  model: string;
  promptTemplate: string;
  lane: OrchestraLaneId;
  mission: string;
  handoff: string;
  evidence: string;
  conflictPolicy: string;
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
    lane: "build",
    mission: "Own the smallest coherent implementation slice and keep edits scoped to the requested behavior.",
    handoff: "List changed files, important decisions, and any assumptions before handing work to review.",
    evidence: "Code diff plus the narrowest passing command that proves the changed behavior.",
    conflictPolicy: "Do not edit broad shared files until the reviewer lane has a conflict note.",
    icon: "I",
    color: "#89b4fa",
    promptTemplate:
      "Implement the following task:\n\n{task}\n\nFocus on writing clean, working code. Follow existing patterns in the codebase.",
  },
  {
    id: "tester",
    label: "Tester",
    model: "sonnet",
    lane: "verify",
    mission: "Turn the task into focused regression checks and keep verification close to user-visible risk.",
    handoff: "Report commands, pass/fail output, uncovered risks, and the next test that would improve confidence.",
    evidence: "Targeted test output, failing repros when found, and coverage of edge cases touched by the task.",
    conflictPolicy:
      "Prefer adding tests beside changed code; avoid rewriting implementation unless a repro demands it.",
    icon: "T",
    color: "#a6e3a1",
    promptTemplate:
      "Write comprehensive tests for the following task:\n\n{task}\n\nCover happy path, edge cases, and error scenarios. Aim for 80%+ coverage.",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    model: "opus",
    lane: "review",
    mission: "Audit the implementation path for correctness, security, UX regressions, and release risk.",
    handoff: "Return ordered findings with file references, severity, and explicit accept/block recommendation.",
    evidence: "Review notes tied to concrete files, risk classification, and any required follow-up command.",
    conflictPolicy: "Do not make cosmetic edits while implementer/tester lanes are active; mark conflicts first.",
    icon: "R",
    color: "#cba6f7",
    promptTemplate:
      "Review the codebase for the following task:\n\n{task}\n\nCheck for bugs, security issues, performance problems, and code quality. Report findings.",
  },
  {
    id: "documenter",
    label: "Documenter",
    model: "haiku",
    lane: "docs",
    mission: "Capture durable user-facing and operator-facing knowledge created by the task.",
    handoff: "Summarize docs changed, docs intentionally skipped, and any runbook entry that future agents need.",
    evidence: "Updated docs, inline notes only where helpful, and a short operator handoff when release gates remain.",
    conflictPolicy: "Avoid editing source files except small comments that unblock maintainability.",
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

/**
 * Active symbol-ownership context for a set of files, as rendered by the BACKEND
 * (`symbol_ownership_prompt_section`) — the single source of truth. Never re-formatted
 * in TS; the frontend embeds `section` verbatim and uses `claimCount` to avoid claiming
 * "parallel-safe" when other agents hold live write claims.
 */
export interface OwnershipPromptSection {
  /** The "[Active symbol ownership — do NOT edit ...]" text; "" when nothing is claimed. */
  section: string;
  /** How many OTHER-agent live write claims touch these files (>0 ⇒ not parallel-safe). */
  claimCount: number;
}

export interface OrchestraConfig {
  task: string;
  roles: string[];
  projectPath: string;
  changedFiles?: readonly string[];
  pendingDecisionCount?: number;
  existingSessionCount?: number;
  /**
   * Active symbol-ownership context for the changed files (backend-fetched). Prepended
   * to every role prompt so a hand-launched agent is warned off the symbols other agents
   * own — the same "do NOT edit" context the autonomy loop injects into its dispatches.
   */
  ownershipContext?: OwnershipPromptSection;
}

export interface OrchestraPrompt {
  roleId: OrchestraRoleId;
  model: string;
  prompt: string;
  branchName: string;
}

export interface OrchestraLanePlan {
  roleId: OrchestraRoleId;
  label: string;
  lane: OrchestraLaneId;
  model: string;
  mission: string;
  handoff: string;
  evidence: string;
  conflictPolicy: string;
}

export interface OrchestraRunPlan {
  task: string;
  projectPath: string;
  selectedRoles: OrchestraLanePlan[];
  dispatchOrder: OrchestraRoleId[];
  mode: "single-lane" | "parallel-lanes" | "review-first";
  laneCount: number;
  worktreePolicy: string;
  conflictPolicy: string;
  handoffContract: string[];
  expectedArtifacts: string[];
  contextPack: {
    include: string[];
    exclude: string[];
    changedFileCount: number;
    pendingDecisionCount: number;
  };
  warnings: string[];
}

function uniqueKnownRoles(roleIds: readonly string[]): OrchestraRole[] {
  const selected: OrchestraRole[] = [];
  const seen = new Set<OrchestraRoleId>();
  for (const roleId of roleIds) {
    const role = ORCHESTRA_ROLES.find((candidate) => candidate.id === roleId);
    if (!role || seen.has(role.id)) continue;
    selected.push(role);
    seen.add(role.id);
  }
  return selected;
}

function deriveMode(roles: readonly OrchestraRole[], pendingDecisionCount: number): OrchestraRunPlan["mode"] {
  if (pendingDecisionCount > 0 || (roles.some((role) => role.id === "reviewer") && roles.length === 1)) {
    return "review-first";
  }
  return roles.length > 1 ? "parallel-lanes" : "single-lane";
}

function buildConflictPolicy(roles: readonly OrchestraRole[], changedFileCount: number): string {
  const hasImplementer = roles.some((role) => role.id === "implementer");
  const hasTester = roles.some((role) => role.id === "tester");
  const hasReviewer = roles.some((role) => role.id === "reviewer");
  if (changedFileCount > 0 && hasReviewer) {
    return "Review existing edits first, then allow implement/test lanes only after conflict notes are attached.";
  }
  if (hasImplementer && hasTester) {
    return "Keep implementation and test lanes in separate panes or worktrees; merge only after both handoffs are visible.";
  }
  return "Use one owner per file path and publish a handoff before another lane edits the same path.";
}

function slugifyBranchPart(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/[/.]{2,}/g, "-")
    .replace(/^-+|^\.+|-+$|\.+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : fallback;
}

export function buildOrchestraBranchName(config: {
  task: string;
  roleId: OrchestraRoleId;
  index: number;
  existingSessionCount?: number;
}): string {
  const taskSlug = slugifyBranchPart(config.task, "task");
  const laneNumber = Math.max(1, (config.existingSessionCount ?? 0) + config.index + 1);
  return `agent/${config.roleId}/${taskSlug}-${laneNumber}`;
}

export function normalizeOrchestraRoutedModel(model: string, fallback: string): string {
  const trimmed = model.trim();
  if (trimmed.length === 0) return fallback;
  if (trimmed.startsWith("claude-")) return trimmed.slice("claude-".length);
  return trimmed;
}

export function buildOrchestraRunPlan(config: OrchestraConfig): OrchestraRunPlan {
  const task = config.task.trim();
  const selectedRoles = uniqueKnownRoles(config.roles);
  const changedFiles = [...(config.changedFiles ?? [])].filter((file) => file.trim().length > 0);
  const pendingDecisionCount = config.pendingDecisionCount ?? 0;
  const mode = deriveMode(selectedRoles, pendingDecisionCount);
  const dispatchOrder = selectedRoles.map((role) => role.id);
  const warnings: string[] = [];

  if (selectedRoles.length === 0) warnings.push("Select at least one known orchestra role before dispatch.");
  if (task.length === 0) warnings.push("Add a concrete objective before launching agents.");
  if (pendingDecisionCount > 0) warnings.push("Resolve pending decision gates before starting new write-heavy lanes.");
  if ((config.existingSessionCount ?? 0) >= 6) {
    warnings.push("Many sessions are already active; prefer review or handoff before spawning more agents.");
  }

  return {
    task,
    projectPath: config.projectPath,
    selectedRoles: selectedRoles.map((role) => ({
      roleId: role.id,
      label: role.label,
      lane: role.lane,
      model: role.model,
      mission: role.mission,
      handoff: role.handoff,
      evidence: role.evidence,
      conflictPolicy: role.conflictPolicy,
    })),
    dispatchOrder,
    mode,
    laneCount: new Set(selectedRoles.map((role) => role.lane)).size,
    worktreePolicy:
      selectedRoles.length > 1
        ? "Prefer one pane or worktree per role; never let two lanes silently own the same file path."
        : "Single lane can stay in the current pane, but must publish an explicit handoff before review.",
    conflictPolicy: buildConflictPolicy(selectedRoles, changedFiles.length),
    handoffContract: [
      "Changed files and rationale",
      "Commands run and result",
      "Open risks, blockers, or decisions",
      "Next recommended owner",
    ],
    expectedArtifacts: [
      "role prompt with task, lane, model, and guardrails",
      "per-lane handoff summary",
      "conflict notes before shared-file edits",
      "verification command output",
    ],
    contextPack: {
      include: [config.projectPath, ...changedFiles.slice(0, 8)],
      exclude: ["node_modules", "src-tauri/target", "dist", ".env"],
      changedFileCount: changedFiles.length,
      pendingDecisionCount,
    },
    warnings,
  };
}

/**
 * Build prompts for each selected role.
 */
export function buildOrchestraPrompts(config: OrchestraConfig): OrchestraPrompt[] {
  const plan = buildOrchestraRunPlan(config);
  return plan.selectedRoles
    .map((lanePlan, index) => {
      const role = ORCHESTRA_ROLES.find((r) => r.id === lanePlan.roleId);
      if (!role) return null;
      const branchName = buildOrchestraBranchName({
        task: plan.task,
        roleId: role.id,
        index,
        existingSessionCount: config.existingSessionCount,
      });
      const ownershipLines = config.ownershipContext?.section
        ? [config.ownershipContext.section.trimEnd(), ""]
        : [];
      return {
        roleId: role.id,
        model: role.model,
        branchName,
        prompt: [
          ...ownershipLines,
          role.promptTemplate.replace("{task}", plan.task),
          "",
          "Aether Orchestra Contract:",
          `- Project: ${plan.projectPath}`,
          `- Worktree branch: ${branchName}`,
          `- Lane: ${role.lane}`,
          `- Mission: ${role.mission}`,
          `- Conflict policy: ${plan.conflictPolicy}`,
          `- Role guardrail: ${role.conflictPolicy}`,
          `- Handoff: ${role.handoff}`,
          `- Evidence: ${role.evidence}`,
          `- Expected artifacts: ${plan.expectedArtifacts.join("; ")}`,
          `- Exclude from context: ${plan.contextPack.exclude.join(", ")}`,
        ].join("\n"),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}
