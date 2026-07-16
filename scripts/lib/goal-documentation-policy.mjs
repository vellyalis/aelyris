export const SCORE_COMMAND = "pnpm verify:quality-score";
export const SCORE_ARTIFACT_PATH = ".codex-auto/quality/release-quality-score.json";
export const AUDIT_COMMAND = "pnpm verify:final-goal-audit";
export const AUDIT_ARTIFACT_PATH = ".codex-auto/quality/final-goal-audit.json";

const VOLATILE_SNAPSHOT_PATTERNS = [
  {
    id: "embedded-release-score",
    pattern: /`?\b\d{1,3}\/100\b`?/,
  },
  {
    id: "embedded-release-candidate-state",
    pattern: /\breleaseCandidateReady=(?:true|false)\b/,
  },
  {
    id: "embedded-audit-count",
    pattern: /\b(?:implementationFixableCount|policyBlockedCount|externalBlockedCount)=\d+\b/,
  },
  {
    id: "embedded-proof-registry-count",
    pattern:
      /\bproofArtifactPassCount=\d+\/\d+\b|(?:safe )?proof registry(?: target| contract)?(?: is| ->|:| =)?\s*`?\d+\/\d+`?/i,
  },
  {
    id: "dated-current-machine-truth-snapshot",
    pattern: /current machine truth[^\n]*\b(?:19|20)\d{2}-\d{2}-\d{2}\b/i,
  },
];

function volatileSnapshotHits(text) {
  return VOLATILE_SNAPSHOT_PATTERNS.filter(({ pattern }) => pattern.test(text ?? "")).map(({ id }) => id);
}

export function evaluateGoalDocumentationPolicy({ path, text, detailed = false, releaseCandidateReady = false }) {
  const snapshotHits = volatileSnapshotHits(text);
  const checks = {
    exists: text != null,
    authoritativeScoreCommandNamed: text?.includes(SCORE_COMMAND) === true,
    authoritativeScoreArtifactNamed: text?.includes(SCORE_ARTIFACT_PATH) === true,
    regenerationPolicyNamed: /\bregenerat(?:e|ed|es|ing|ion)\b|再生成/i.test(text ?? ""),
    noVolatileMachineTruthSnapshot: snapshotHits.length === 0,
    noStaleLegacyScoreClaim: !/100\/116/.test(text ?? ""),
    noStaleReleaseReadyClaim: releaseCandidateReady === true ? true : !/releaseCandidateReady=true/.test(text ?? ""),
    authoritativeAuditCommandNamed: text?.includes(AUDIT_COMMAND) === true,
    authoritativeAuditArtifactNamed: text?.includes(AUDIT_ARTIFACT_PATH) === true,
    consentGateNamed: text?.includes("authenticated-ai-cli-prompt-smoke") === true,
    consentPacketNamed: text?.includes("authenticated-ai-cli-consent-packet") === true,
    consentProviderRequired: text?.includes("AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini") === true,
  };
  const requiredChecks = [
    "exists",
    "authoritativeScoreCommandNamed",
    "authoritativeScoreArtifactNamed",
    "regenerationPolicyNamed",
    "noVolatileMachineTruthSnapshot",
    "noStaleLegacyScoreClaim",
    "noStaleReleaseReadyClaim",
    ...(detailed
      ? [
          "authoritativeAuditCommandNamed",
          "authoritativeAuditArtifactNamed",
          "consentGateNamed",
          "consentPacketNamed",
          "consentProviderRequired",
        ]
      : []),
  ];
  return {
    path,
    checks,
    requiredChecks,
    volatileSnapshotHits: snapshotHits,
    ok: requiredChecks.every((id) => checks[id] === true),
  };
}

export function generatedArtifactIsCurrent(artifact, localDate, nowMs = Date.now()) {
  const generatedAtMs = Date.parse(artifact?.generatedAt ?? "");
  return artifact?.localDate === localDate && Number.isFinite(generatedAtMs) && generatedAtMs <= nowMs + 5 * 60 * 1000;
}

export function goalDocumentationPolicySelfTest() {
  const stable = [
    "Aelyris remains alpha and not release-ready.",
    `Regenerate with \`${SCORE_COMMAND}\` and read \`${SCORE_ARTIFACT_PATH}\`.`,
  ].join("\n");
  const detailed = [
    stable,
    `Regenerate with \`${AUDIT_COMMAND}\` and read \`${AUDIT_ARTIFACT_PATH}\`.`,
    "authenticated-ai-cli-prompt-smoke",
    "authenticated-ai-cli-consent-packet",
    "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
  ].join("\n");
  const cases = {
    stableSourceLinkPasses: evaluateGoalDocumentationPolicy({
      path: "stable.md",
      text: stable,
    }).ok,
    detailedSourceLinkPasses: evaluateGoalDocumentationPolicy({
      path: "detailed.md",
      text: detailed,
      detailed: true,
    }).ok,
    copiedScoreFails: !evaluateGoalDocumentationPolicy({
      path: "copied-score.md",
      text: `${stable}\nCurrent score is 23/100.`,
    }).ok,
    copiedBlockerCountFails: !evaluateGoalDocumentationPolicy({
      path: "copied-count.md",
      text: `${stable}\nimplementationFixableCount=194`,
    }).ok,
    unsupportedReleaseClaimFails: !evaluateGoalDocumentationPolicy({
      path: "unsupported-release.md",
      text: `${stable}\nreleaseCandidateReady=true`,
      releaseCandidateReady: false,
    }).ok,
    missingArtifactOwnerFails: !evaluateGoalDocumentationPolicy({
      path: "missing-owner.md",
      text: `Regenerate with \`${SCORE_COMMAND}\`.`,
    }).ok,
  };
  return {
    cases,
    ok: Object.values(cases).every(Boolean),
  };
}
