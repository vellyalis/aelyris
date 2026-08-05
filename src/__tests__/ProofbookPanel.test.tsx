import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofbookPanel } from "../features/proofbooks/ProofbookPanel";
import type {
  ProofbookArtifactPreview,
  ProofbookRunLedger,
  ProofbookSummary,
} from "../shared/types/proofbook";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

const CATALOG: ProofbookSummary[] = [
  {
    id: "release-closeout",
    title: "Release closeout",
    path: "C:/repo/.aelyris/proofbooks/release.proofbook.yaml",
    stepCount: 3,
    valid: true,
    errorCount: 0,
  },
  {
    id: "broken-audit",
    title: "Broken audit",
    path: "C:/repo/.aelyris/proofbooks/broken.proofbook.yaml",
    stepCount: 2,
    valid: false,
    errorCount: 1,
  },
];

const INPUT_FREE_ADMISSION = {
  eligible: true,
  definitionHash: "sha256:validated-definition-hash",
  inputCount: 0,
  secretCount: 0,
  unsupportedStepKinds: [],
  blockers: [],
};

function run(overrides: Partial<ProofbookRunLedger> = {}): ProofbookRunLedger {
  return {
    schema: "aelyris.proofbook_run.v1",
    revision: 2,
    runId: "run-1",
    proofbookId: "release-closeout",
    projectPath: "C:/repo",
    definitionPath: CATALOG[0].path,
    status: "passed",
    startedAt: "2026-08-05T05:00:00.000Z",
    updatedAt: "2026-08-05T05:01:00.000Z",
    definitionHash: "definition-hash",
    inputHash: "input-hash",
    steps: [
      { stepId: "build", kind: "shell", status: "passed", artifactRefs: [], redactionCount: 0 },
      { stepId: "review", kind: "verifier", status: "passed", artifactRefs: ["artifact-1"], redactionCount: 0 },
    ],
    artifacts: [
      {
        id: "artifact-1",
        path: ".aelyris/runs/run-1/review.txt",
        kind: "text",
        sizeBytes: 20,
        sha256: "artifact-hash",
        redactionCount: 0,
        stepId: "review",
      },
    ],
    residualBlockers: [],
    ...overrides,
  };
}

function manualGateRun(overrides: Partial<ProofbookRunLedger> = {}): ProofbookRunLedger {
  return run({
    runId: "run-gate",
    status: "waiting_gate",
    updatedAt: "2026-08-05T05:02:00.000Z",
    steps: [
      {
        stepId: "approve-release",
        kind: "manualGate",
        status: "waiting_gate",
        structuredOutput: {
          gateId: "release-check",
          gateHash: "sha256:current-gate-hash",
          kind: "manualGate",
          options: ["approve", "reject"],
          default: "reject",
          risk: "high",
          evidence: "Release evidence is complete and awaits operator acceptance.",
        },
        artifactRefs: [],
        redactionCount: 0,
      },
    ],
    artifacts: [],
    ...overrides,
  });
}

function runningRun(overrides: Partial<ProofbookRunLedger> = {}): ProofbookRunLedger {
  return run({
    revision: 4,
    runId: "run-live",
    status: "running",
    updatedAt: "2026-08-05T05:03:00.000Z",
    steps: [
      {
        stepId: "verify",
        kind: "verifier",
        status: "running",
        artifactRefs: [],
        redactionCount: 0,
      },
    ],
    artifacts: [],
    ...overrides,
  });
}

function previewableArtifactRun(overrides: Partial<ProofbookRunLedger> = {}): ProofbookRunLedger {
  return run({
    revision: 6,
    runId: "run-preview",
    artifacts: [
      {
        id: "artifact-preview",
        path: ".aelyris/proofbook-runs/artifacts/run-preview/echo-stdout.txt",
        kind: "stdout",
        sizeBytes: 18,
        sha256: "sha256:verified-artifact",
        redactionCount: 1,
        stepId: "echo",
      },
    ],
    ...overrides,
  });
}

beforeEach(() => {
  tauriMocks.invoke.mockReset();
  tauriMocks.listen.mockReset();
  tauriMocks.listen.mockResolvedValue(vi.fn());
});

afterEach(cleanup);

describe("ProofbookPanel", () => {
  it("shows the catalog, explicit validation, and durable run history without unrelated effect controls", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") return Promise.resolve([run()]);
      if (command === "validate_proofbook") {
        return Promise.resolve({
          definitionId: "release-closeout",
          path: CATALOG[0].path,
          valid: true,
          errors: [],
          startAdmission: {
            ...INPUT_FREE_ADMISSION,
            eligible: false,
            inputCount: 1,
            blockers: ["runtime_inputs_declared"],
          },
        });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);

    expect(await screen.findByText("Release closeout")).toBeTruthy();
    expect(screen.getByText("Broken audit")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("2/2 steps")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start|run|cancel|settle/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Validate release.proofbook.yaml" }));

    expect(await screen.findByText("Definition valid")).toBeTruthy();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("validate_proofbook", {
      projectPath: "C:/repo",
      proofbookPath: CATALOG[0].path,
    });
    expect(screen.getByText(/runtime_inputs_declared/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start validated Proofbook/ })).toBeNull();
  });

  it("starts only after fresh input-free validation and sends the exact definition hash", async () => {
    let releaseStart: (ledger: ProofbookRunLedger) => void = () => {};
    const startPromise = new Promise<ProofbookRunLedger>((resolve) => {
      releaseStart = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") return Promise.resolve([]);
      if (command === "validate_proofbook") {
        return Promise.resolve({
          definitionId: "release-closeout",
          path: CATALOG[0].path,
          valid: true,
          errors: [],
          startAdmission: INPUT_FREE_ADMISSION,
        });
      }
      if (command === "start_input_free_proofbook_run") return startPromise;
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);
    expect(await screen.findByText("Release closeout")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start validated Proofbook release.proofbook.yaml" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Validate release.proofbook.yaml" }));
    const start = await screen.findByRole("button", { name: "Start validated Proofbook release.proofbook.yaml" });
    expect(screen.getByText("sha256:validated-definition-hash")).toBeTruthy();

    fireEvent.click(start);
    fireEvent.click(start);

    await waitFor(() => {
      const calls = tauriMocks.invoke.mock.calls.filter(([command]) => command === "start_input_free_proofbook_run");
      expect(calls).toHaveLength(1);
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("start_input_free_proofbook_run", {
      projectPath: "C:/repo",
      proofbookPath: CATALOG[0].path,
      expectedDefinitionHash: "sha256:validated-definition-hash",
    });

    releaseStart(run({ runId: "run-started", status: "passed" }));
    expect(await screen.findByText(/Started release-closeout/)).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
  });

  it("requires revalidation when the definition hash changes before start", async () => {
    let catalogReads = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") {
        catalogReads += 1;
        return Promise.resolve(CATALOG);
      }
      if (command === "list_proofbook_runs") return Promise.resolve([]);
      if (command === "validate_proofbook") {
        return Promise.resolve({
          definitionId: "release-closeout",
          path: CATALOG[0].path,
          valid: true,
          errors: [],
          startAdmission: INPUT_FREE_ADMISSION,
        });
      }
      if (command === "start_input_free_proofbook_run") {
        return Promise.reject({
          code: "stale_definition_hash",
          message: "validate again before starting",
        });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: "Validate release.proofbook.yaml" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start validated Proofbook release.proofbook.yaml" }));

    expect(await screen.findByText(/changed after validation/)).toBeTruthy();
    expect(catalogReads).toBe(2);
    expect(screen.queryByRole("button", { name: "Start validated Proofbook release.proofbook.yaml" })).toBeNull();
  });

  it("cancels only the exact displayed non-terminal revision and latches rapid clicks", async () => {
    let releaseCancel: (ledger: ProofbookRunLedger) => void = () => {};
    const cancelPromise = new Promise<ProofbookRunLedger>((resolve) => {
      releaseCancel = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") return Promise.resolve([runningRun(), run({ runId: "run-passed" })]);
      if (command === "cancel_current_proofbook_run") return cancelPromise;
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);

    expect(await screen.findByText("run-live")).toBeTruthy();
    expect(screen.getByText("revision 4")).toBeTruthy();
    expect(screen.getByText(/does not prove an external process was terminated/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel current Proofbook run run-passed" })).toBeNull();

    const cancel = screen.getByRole("button", { name: "Cancel current Proofbook run run-live" });
    fireEvent.click(cancel);
    fireEvent.click(cancel);

    await waitFor(() => {
      const calls = tauriMocks.invoke.mock.calls.filter(([command]) => command === "cancel_current_proofbook_run");
      expect(calls).toHaveLength(1);
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("cancel_current_proofbook_run", {
      projectPath: "C:/repo",
      runId: "run-live",
      expectedRevision: 4,
    });

    releaseCancel(
      runningRun({
        revision: 5,
        status: "cancelled",
        steps: [
          {
            stepId: "verify",
            kind: "verifier",
            status: "cancelled",
            artifactRefs: [],
            redactionCount: 0,
          },
        ],
      }),
    );

    expect(await screen.findByText(/Marked run-live cancelled in durable Proofbook state at revision 5/)).toBeTruthy();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Cancel current Proofbook run run-live" })).toBeNull();
  });

  it("refreshes a stale cancellation revision before exposing another operator action", async () => {
    let listRunsCount = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") {
        listRunsCount += 1;
        return Promise.resolve([runningRun({ revision: listRunsCount === 1 ? 4 : 5 })]);
      }
      if (command === "cancel_current_proofbook_run") {
        return Promise.reject({
          code: "stale_ledger_revision",
          message: "current revision is 5",
        });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel current Proofbook run run-live" }));

    expect(await screen.findByText(/Run run-live changed before cancellation/)).toBeTruthy();
    expect(listRunsCount).toBe(2);
    expect(screen.getByText("revision 5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel current Proofbook run run-live" })).toBeTruthy();
  });

  it("previews only a runner-owned artifact at the exact displayed ledger revision", async () => {
    let releasePreview: (preview: ProofbookArtifactPreview) => void = () => {};
    const previewPromise = new Promise<ProofbookArtifactPreview>((resolve) => {
      releasePreview = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") {
        return Promise.resolve([
          previewableArtifactRun(),
          run({
            runId: "run-external-artifact",
            artifacts: [
              {
                id: "artifact-external",
                path: "reports/external.txt",
                kind: "text",
                sizeBytes: 12,
                sha256: "sha256:external",
                redactionCount: 0,
                stepId: "report",
              },
            ],
          }),
        ]);
      }
      if (command === "preview_current_proofbook_artifact") return previewPromise;
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);

    const preview = await screen.findByRole("button", { name: "Preview Proofbook artifact artifact-preview" });
    expect(screen.getAllByText("Metadata only").length).toBeGreaterThan(0);
    fireEvent.click(preview);
    fireEvent.click(preview);

    await waitFor(() => {
      const calls = tauriMocks.invoke.mock.calls.filter(
        ([command]) => command === "preview_current_proofbook_artifact",
      );
      expect(calls).toHaveLength(1);
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("preview_current_proofbook_artifact", {
      projectPath: "C:/repo",
      runId: "run-preview",
      artifactId: "artifact-preview",
      expectedRevision: 6,
    });

    releasePreview({
      ledgerRevision: 6,
      runId: "run-preview",
      artifactId: "artifact-preview",
      stepId: "echo",
      kind: "stdout",
      sizeBytes: 18,
      sha256: "sha256:verified-artifact",
      redactionCount: 1,
      encoding: "utf-8",
      content: "verified content\n",
    });

    expect(await screen.findByRole("region", { name: "Proofbook artifact preview" })).toBeTruthy();
    expect(screen.getByText("verified content")).toBeTruthy();
    expect(screen.getByText("sha256:verified-artifact")).toBeTruthy();
    expect(screen.getByText(/does not prove semantic removal/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Proofbook artifact preview" }));
    expect(screen.queryByRole("region", { name: "Proofbook artifact preview" })).toBeNull();
  });

  it("refreshes a stale artifact revision instead of previewing old content", async () => {
    let listRunsCount = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") {
        listRunsCount += 1;
        return Promise.resolve([previewableArtifactRun({ revision: listRunsCount === 1 ? 6 : 7 })]);
      }
      if (command === "preview_current_proofbook_artifact") {
        return Promise.reject({
          code: "stale_ledger_revision",
          message: "current revision is 7",
        });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview Proofbook artifact artifact-preview" }));

    expect(await screen.findByText(/Artifact artifact-preview changed or disappeared before preview/)).toBeTruthy();
    expect(listRunsCount).toBe(2);
    expect(screen.getByText("revision 7")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Proofbook artifact preview" })).toBeNull();
  });

  it("projects live run-ledger updates only for the active project", async () => {
    const listener: { current?: (event: { payload: ProofbookRunLedger }) => void } = {};
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks" || command === "list_proofbook_runs") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
    tauriMocks.listen.mockImplementation((name: string, callback: (event: { payload: ProofbookRunLedger }) => void) => {
      if (name === "proofbook-updated") listener.current = callback;
      return Promise.resolve(vi.fn());
    });

    render(<ProofbookPanel projectPath="C:/repo" />);
    await waitFor(() => expect(listener.current).toBeTypeOf("function"));

    act(() => {
      listener.current?.({
        payload: run({ runId: "run-live", projectPath: "\\\\?\\C:\\repo", status: "waiting_gate" }),
      });
      listener.current?.({ payload: run({ runId: "run-other", projectPath: "C:/other", status: "failed" }) });
    });

    expect(await screen.findByText("Waiting gate")).toBeTruthy();
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("resolves only the displayed manual gate with its exact hash and fixed cockpit actor", async () => {
    let releaseResolution: (ledger: ProofbookRunLedger) => void = () => {};
    const resolution = new Promise<ProofbookRunLedger>((resolve) => {
      releaseResolution = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") return Promise.resolve([manualGateRun()]);
      if (command === "resolve_proofbook_manual_gate") return resolution;
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);

    expect(await screen.findByText("Release evidence is complete and awaits operator acceptance.")).toBeTruthy();
    expect(screen.getByText("sha256:current-gate-hash")).toBeTruthy();
    expect(screen.getByText("cockpit-operator")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();

    const approve = screen.getByRole("button", { name: "Approve manual gate release-check" });
    fireEvent.click(approve);
    fireEvent.click(approve);

    await waitFor(() => {
      const calls = tauriMocks.invoke.mock.calls.filter(([command]) => command === "resolve_proofbook_manual_gate");
      expect(calls).toHaveLength(1);
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("resolve_proofbook_manual_gate", {
      projectPath: "C:/repo",
      runId: "run-gate",
      gateId: "release-check",
      gateHash: "sha256:current-gate-hash",
      decision: "approve",
      actor: "cockpit-operator",
      comment: null,
    });

    releaseResolution(
      manualGateRun({
        status: "passed",
        steps: [
          {
            stepId: "approve-release",
            kind: "manualGate",
            status: "passed",
            artifactRefs: [],
            redactionCount: 0,
          },
        ],
      }),
    );

    expect(await screen.findByText(/Approved release-check/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve manual gate release-check" })).toBeNull();
  });

  it("does not expose the manual resolver for another Proofbook gate kind", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") {
        return Promise.resolve([
          manualGateRun({
            steps: [
              {
                stepId: "commit",
                kind: "shell",
                status: "waiting_gate",
                structuredOutput: {
                  gateId: "command-risk",
                  gateHash: "sha256:command-risk",
                  kind: "commandRisk",
                  options: ["approve", "reject"],
                  default: "reject",
                },
                artifactRefs: [],
                redactionCount: 0,
              },
            ],
          }),
        ]);
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);

    expect(await screen.findByText("Waiting gate")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Proofbook manual gates" })).toBeNull();
    expect(screen.queryByRole("button", { name: /manual gate/i })).toBeNull();
  });

  it("refreshes instead of retrying a stale manual-gate hash", async () => {
    let listRunsCount = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_proofbooks") return Promise.resolve(CATALOG);
      if (command === "list_proofbook_runs") {
        listRunsCount += 1;
        return Promise.resolve([
          manualGateRun({
            steps: [
              {
                ...manualGateRun().steps[0],
                structuredOutput: {
                  ...(manualGateRun().steps[0].structuredOutput as Record<string, unknown>),
                  gateHash: listRunsCount === 1 ? "sha256:current-gate-hash" : "sha256:replacement-gate-hash",
                },
              },
            ],
          }),
        ]);
      }
      if (command === "resolve_proofbook_manual_gate") {
        return Promise.reject({ code: "stale_gate_hash", message: "refresh run status and retry" });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    render(<ProofbookPanel projectPath="C:/repo" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject manual gate release-check" }));

    expect(await screen.findByText(/Gate release-check changed before delivery/)).toBeTruthy();
    expect(listRunsCount).toBe(2);
    expect(screen.getByText("sha256:replacement-gate-hash")).toBeTruthy();
  });
});
