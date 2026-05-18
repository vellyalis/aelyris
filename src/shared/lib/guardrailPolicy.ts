import type { WorkforceGuardrailProfile } from "./rightRailWorkforce";
import { type CommandRiskOptions, type CommandRiskReport, classifyCommand } from "./shellSafety";

export type GuardrailCommandStatus = "allow" | "manual" | "block";

export interface GuardrailCommandDecision {
  profile: WorkforceGuardrailProfile;
  status: GuardrailCommandStatus;
  label: string;
  detail: string;
  risk: CommandRiskReport;
}

export interface GuardrailProfileDescriptor {
  profile: WorkforceGuardrailProfile;
  label: string;
  detail: string;
  allowedTools: string[];
}

const PROFILE_DESCRIPTORS: Record<WorkforceGuardrailProfile, GuardrailProfileDescriptor> = {
  Conservative: {
    profile: "Conservative",
    label: "Human gated",
    detail: "Read, inspect, and evidence collection are safe; mutation and recovery require an owner decision.",
    allowedTools: ["Read", "Grep", "Glob", "LS"],
  },
  Release: {
    profile: "Release",
    label: "Evidence gated",
    detail: "Inspection and validation can run; writes, dependency changes, and publishing stay manual.",
    allowedTools: ["Read", "Grep", "Glob", "LS", "Bash"],
  },
  Builder: {
    profile: "Builder",
    label: "Local builder",
    detail: "Focused local edits, tests, and inspection are allowed; destructive or remote actions stay manual.",
    allowedTools: ["Read", "Grep", "Glob", "LS", "Edit", "MultiEdit", "Write", "Bash"],
  },
  Research: {
    profile: "Research",
    label: "Explore first",
    detail: "Read-only exploration and validation are allowed before mutating workspace state.",
    allowedTools: ["Read", "Grep", "Glob", "LS", "Bash"],
  },
};

export function describeGuardrailProfile(profile: WorkforceGuardrailProfile): GuardrailProfileDescriptor {
  return PROFILE_DESCRIPTORS[profile];
}

export function allowedToolsForGuardrailProfile(profile: WorkforceGuardrailProfile): string[] {
  return [...PROFILE_DESCRIPTORS[profile].allowedTools];
}

function hasOnlyReadOrTestRisk(risk: CommandRiskReport): boolean {
  return risk.classes.every((riskClass) => riskClass === "read-only" || riskClass === "build/test");
}

function isLocalMutation(risk: CommandRiskReport): boolean {
  return risk.classes.every((riskClass) => ["read-only", "build/test", "file mutation"].includes(riskClass));
}

export function gateCommandForGuardrailProfile(
  command: string,
  profile: WorkforceGuardrailProfile,
  options: CommandRiskOptions = {},
): GuardrailCommandDecision {
  const risk = classifyCommand(command, options);
  const descriptor = describeGuardrailProfile(profile);

  if (!risk.allowExecution || risk.severity === "deny") {
    return {
      profile,
      status: "block",
      label: "Blocked",
      detail: risk.reasons[0] ?? "The command is outside the current safety envelope.",
      risk,
    };
  }

  if (profile === "Conservative") {
    return {
      profile,
      status: risk.severity === "allow" && hasOnlyReadOrTestRisk(risk) ? "allow" : "manual",
      label: descriptor.label,
      detail:
        risk.severity === "allow" && hasOnlyReadOrTestRisk(risk)
          ? "Safe inspection or validation command."
          : "Conservative mode requires owner confirmation before mutation or recovery.",
      risk,
    };
  }

  if (profile === "Release") {
    const allowed = risk.severity === "allow" || hasOnlyReadOrTestRisk(risk);
    return {
      profile,
      status: allowed ? "allow" : "manual",
      label: descriptor.label,
      detail: allowed
        ? "Release mode allows inspection and validation evidence."
        : "Release mode keeps mutation, dependency, remote, and publish-like actions manual.",
      risk,
    };
  }

  if (profile === "Builder") {
    const manual = risk.classes.some((riskClass) =>
      [
        "git mutation",
        "package install",
        "network",
        "process kill",
        "permission",
        "secret-bearing",
        "unknown",
      ].includes(riskClass),
    );
    return {
      profile,
      status: manual && !isLocalMutation(risk) ? "manual" : "allow",
      label: descriptor.label,
      detail:
        manual && !isLocalMutation(risk)
          ? "Builder mode keeps remote, dependency, git, and permission changes manual."
          : "Builder mode allows focused local work and validation.",
      risk,
    };
  }

  return {
    profile,
    status: hasOnlyReadOrTestRisk(risk) ? "allow" : "manual",
    label: descriptor.label,
    detail: hasOnlyReadOrTestRisk(risk)
      ? "Research mode allows reading and validation."
      : "Research mode asks for confirmation before workspace mutation.",
    risk,
  };
}
