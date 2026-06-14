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

export type StartInteractiveSession = (opts: InteractiveLaunchOptions) => Promise<unknown>;

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
): Promise<number> {
  const launches = await Promise.allSettled(
    prompts.map((prompt) =>
      startInteractiveSession({
        cwd: projectPath,
        model: prompt.model,
        initialPrompt: prompt.prompt,
        branchName: prompt.branchName,
      }),
    ),
  );

  return launches.filter((launch) => launch.status === "fulfilled" && launch.value).length;
}
