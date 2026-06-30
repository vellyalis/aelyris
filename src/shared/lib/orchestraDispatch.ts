import {
  normalizeOrchestraRoutedModel,
  type OrchestraPrompt,
} from "./orchestrator";

export interface OrchestraRoutingDecision {
  recommended_model: string;
  reasoning: string;
  estimated_cost: number;
  fallback_model: string;
  task_type: string;
  complexity: string;
}

export type RouteAgentPrompt = (prompt: string) => Promise<OrchestraRoutingDecision>;

export interface InteractiveLaunchOptions {
  cwd: string;
  model?: string;
  initialPrompt?: string;
  branchName?: string;
}

/** Structural subset of the interactive SpawnResult the dispatcher needs. */
export type StartInteractiveSession = (
  opts: InteractiveLaunchOptions,
) => Promise<{ pty_id: string; backend?: string } | null>;

/** One successfully launched orchestra role, carrying the pty to mount as a pane. */
export interface OrchestraLaunch {
  roleId: string;
  model: string;
  branchName?: string;
  /** The spawned interactive PTY id — the key to bind into a central pane. */
  terminalId: string;
  backend?: string;
}

export async function routeOrchestraPrompts(
  prompts: readonly OrchestraPrompt[],
  routeAgent: RouteAgentPrompt,
  enabled: boolean,
): Promise<OrchestraPrompt[]> {
  if (!enabled) return [...prompts];

  return await Promise.all(
    prompts.map(async (prompt) => {
      try {
        const decision = await routeAgent(prompt.prompt);
        return {
          ...prompt,
          model: normalizeOrchestraRoutedModel(decision.recommended_model, prompt.model),
        };
      } catch {
        return prompt;
      }
    }),
  );
}

export async function launchOrchestraPrompts(
  prompts: readonly OrchestraPrompt[],
  projectPath: string,
  startInteractiveSession: StartInteractiveSession,
): Promise<OrchestraLaunch[]> {
  const launches = await Promise.allSettled(
    prompts.map(async (prompt): Promise<OrchestraLaunch | null> => {
      const result = await startInteractiveSession({
        cwd: projectPath,
        model: prompt.model,
        initialPrompt: prompt.prompt,
        branchName: prompt.branchName,
      });
      if (!result?.pty_id) return null;
      return {
        roleId: prompt.roleId,
        model: prompt.model,
        branchName: prompt.branchName,
        terminalId: result.pty_id,
        backend: result.backend,
      };
    }),
  );

  return launches.flatMap((launch) =>
    launch.status === "fulfilled" && launch.value ? [launch.value] : [],
  );
}
