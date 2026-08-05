import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofbookPanel } from "../features/proofbooks/ProofbookPanel";
import type { ProofbookRunLedger, ProofbookSummary } from "../shared/types/proofbook";

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
        return Promise.resolve({ definitionId: "release-closeout", path: CATALOG[0].path, valid: true, errors: [] });
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
