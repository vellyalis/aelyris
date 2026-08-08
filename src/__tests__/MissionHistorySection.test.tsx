import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionHistorySection } from "../features/orchestrator/MissionHistorySection";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

const priorDigest = "a".repeat(64);
const currentDigest = "c".repeat(64);

const boundary = {
  source: "sqlite-backed-task-manager-mission-history",
  readOnly: true,
  restartSafe: true,
  bounded: true,
  historyCacheUsed: false,
  historyIndexUsed: false,
  eventHistoryUsed: false,
  repositoryPathExposed: false,
  packetIdentityExposed: false,
  packetContentsExposed: false,
};

const baseHistory = {
  outcome: "ok",
  repositoryDigest: "b".repeat(64),
  requestedLimit: 20,
  effectiveLimit: 20,
  returnedCount: 2,
  hasMore: false,
  entries: [
    {
      missionId: "019fe146-6803-70b1-a124-0bb6caaf6b22",
      missionRevision: 1,
      planId: "019fe146-6803-70b1-a124-0bc53e9c22d1",
      planRevision: 1,
      status: "accepted",
      current: true,
      taskCount: 1,
      currentTaskSummary: {
        available: true,
        exact: true,
        taskCount: 1,
        statusCounts: { ready: 1 },
      },
      completion: {
        state: "incomplete",
        packetBacked: false,
        workPacketCount: 0,
        missionCompletionPacketPresent: false,
        receiptDigest: null,
      },
    },
    {
      missionId: "019fe063-fee3-7523-a00f-638599bcafb1",
      missionRevision: 1,
      planId: "019fe063-fee3-7523-a00f-639dedb360d0",
      planRevision: 1,
      status: "accepted",
      current: false,
      taskCount: 1,
      currentTaskSummary: null,
      completion: {
        state: "completed",
        packetBacked: true,
        workPacketCount: 1,
        missionCompletionPacketPresent: true,
        receiptDigest: priorDigest,
      },
    },
  ],
  boundary,
};

const completedReceipt = {
  outcome: "completed",
  completed: true,
  mission: {
    missionId: baseHistory.entries[0].missionId,
    missionRevision: 1,
    planId: baseHistory.entries[0].planId,
    planRevision: 1,
    status: "accepted",
  },
  taskSummary: {
    taskCount: 1,
    statusCounts: { done: 1 },
  },
  completion: {
    packetBacked: true,
    workPacketIds: ["019fe065-af6d-7e53-9b5f-df4df5371490"],
    workPacketCount: 1,
    missionCompletionPacketId: "019fe065-af6e-7153-ba85-07cee8ea2ad8",
    missionCompletionPacketPresent: true,
    receiptDigest: currentDigest,
    exactPacketReferencesReturned: true,
  },
  continuity: {
    source: "sqlite-backed-task-manager-settlement",
    readOnly: true,
    restartSafe: true,
    settlementReplayed: false,
    reviewerInvoked: false,
    mergeInvoked: false,
    eventAckInvoked: false,
    gitMutated: false,
  },
  exposure: {
    packetContentsExposed: false,
    taskIdentityExposed: false,
    oidValuesExposed: false,
  },
};

const timelineHash = "e".repeat(64);
const checkpointHashOne = "f".repeat(64);
const checkpointHashTwo = "1".repeat(64);

const replayExposure = {
  repositoryPathExposed: false,
  rawGoalOrContextExposed: false,
  taskIdentityOrPayloadExposed: false,
  executionIdentityExposed: false,
  eventIdentityOrPayloadExposed: false,
  globalEventSequenceExposed: false,
  oidValuesExposed: false,
  reviewOrEvidenceExposed: false,
  packetIdentityOrContentsExposed: false,
  checkpointPrivateMaterialExposed: false,
  recoveryOrRollbackAuthorityExposed: false,
};

const replayTimeline = {
  schema: "aelyris.mission-replay-timeline-read/v1",
  outcome: "ok",
  found: true,
  requestedLimit: 20,
  effectiveLimit: 20,
  timeline: {
    mission: {
      missionId: baseHistory.entries[0].missionId,
      missionRevision: 1,
      planId: baseHistory.entries[0].planId,
      planRevision: 1,
      status: "accepted",
    },
    timelineHash,
    totalCheckpointCount: 4,
    returnedCheckpointCount: 2,
    returnedStartPosition: 2,
    hasMore: true,
    checkpoints: [
      {
        position: 2,
        eventKind: "execution_reserved",
        taskStatusCounts: { running: 1 },
        completedWorkCount: 0,
        packetBackedMissionState: "incomplete",
        checkpointHash: checkpointHashOne,
      },
      {
        position: 3,
        eventKind: "review_required",
        taskStatusCounts: { review: 1 },
        completedWorkCount: 0,
        packetBackedMissionState: "incomplete",
        checkpointHash: checkpointHashTwo,
      },
    ],
    finalTaskStatusCounts: { review: 1 },
    finalCompletedWorkCount: 0,
    finalPacketBackedMissionState: "incomplete",
    source: {
      taskCount: 1,
      executionCount: 1,
      durableEventCount: 3,
      durableEventScannedCount: 5,
      durableEventHighWaterSeq: 42,
      workPacketCount: 0,
      missionCompletionPacketPresent: false,
    },
    guarantees: {
      readOnly: true,
      deterministic: true,
      restartSafe: true,
      sideEffectCount: 0,
      secondJournalUsed: false,
      secondTaskGraphUsed: false,
      secondPacketStoreUsed: false,
      replayCacheUsed: false,
    },
  },
  exposure: replayExposure,
};

describe("MissionHistorySection", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("stays on demand until the operator expands the existing cockpit section", () => {
    render(<MissionHistorySection repoPath="C:/repo" />);
    expect(screen.getByText("Mission history")).toBeTruthy();
    expect(screen.getAllByText("On demand")).toHaveLength(2);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it("distinguishes the exact current incomplete Mission from prior packet-backed completion", async () => {
    tauriMocks.invoke.mockResolvedValue(baseHistory);
    render(<MissionHistorySection repoPath="C:/repo" />);

    fireEvent.click(screen.getByText("Mission history"));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("cockpit_mission_history", {
        repoPath: "C:/repo",
        limit: 20,
      }),
    );
    expect(await screen.findByText("Current")).toBeTruthy();
    expect(screen.getByText("Incomplete")).toBeTruthy();
    expect(screen.getByText("1 ready")).toBeTruthy();
    expect(screen.getByText("Packet-backed")).toBeTruthy();
    expect(screen.getByText(priorDigest.slice(0, 16))).toBeTruthy();
    expect(screen.queryByText(/019fe065-af6d-7e53/i)).toBeNull();
  });

  it("copies only the safe immutable completion digest from history", async () => {
    tauriMocks.invoke.mockResolvedValue(baseHistory);
    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));

    const copy = await screen.findByRole("button", { name: /Copy completion digest/i });
    fireEvent.click(copy);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(priorDigest);
    });
  });

  it("renders inconsistent packet lineage as explicit non-completion", async () => {
    tauriMocks.invoke.mockResolvedValue({
      ...baseHistory,
      returnedCount: 1,
      entries: [
        {
          ...baseHistory.entries[0],
          completion: {
            state: "inconsistent",
            packetBacked: false,
            workPacketCount: 0,
            missionCompletionPacketPresent: false,
            receiptDigest: null,
          },
        },
      ],
    });
    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));

    expect(await screen.findByText("Needs reconciliation")).toBeTruthy();
    expect(screen.getByText("Packet lineage is inconsistent. Completion is not trusted.")).toBeTruthy();
    expect(screen.queryByText("Packet-backed")).toBeNull();
  });

  it("loads older entries only on request and respects the finite server limit", async () => {
    tauriMocks.invoke
      .mockResolvedValueOnce({
        ...baseHistory,
        returnedCount: 20,
        hasMore: true,
        entries: Array.from({ length: 20 }, (_, index) => ({
          ...baseHistory.entries[index % 2],
          missionId: `mission-${index}`,
          planId: `plan-${index}`,
          current: index === 0,
        })),
      })
      .mockResolvedValueOnce({
        ...baseHistory,
        requestedLimit: 40,
        effectiveLimit: 40,
        returnedCount: 25,
        hasMore: false,
        entries: Array.from({ length: 25 }, (_, index) => ({
          ...baseHistory.entries[index % 2],
          missionId: `mission-${index}`,
          planId: `plan-${index}`,
          current: index === 0,
        })),
      });

    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByRole("button", { name: "Load older" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenLastCalledWith("cockpit_mission_history", {
        repoPath: "C:/repo",
        limit: 40,
      }),
    );
    expect(await screen.findByText("25 shown")).toBeTruthy();
  });

  it("inspects exact current packet references without opening packet contents", async () => {
    const currentCompletedHistory = {
      ...baseHistory,
      returnedCount: 1,
      entries: [
        {
          ...baseHistory.entries[0],
          completion: {
            state: "completed",
            packetBacked: true,
            workPacketCount: 1,
            missionCompletionPacketPresent: true,
            receiptDigest: currentDigest,
          },
        },
      ],
    };
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cockpit_mission_history") return Promise.resolve(currentCompletedHistory);
      if (command === "cockpit_mission_completion") return Promise.resolve(completedReceipt);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByRole("button", { name: "Inspect receipt" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("cockpit_mission_completion", {
        repoPath: "C:/repo",
      }),
    );
    expect(await screen.findByText("Completion receipt")).toBeTruthy();
    expect(screen.getByText("019fe065-af6d-7e")).toBeTruthy();
    expect(screen.getByText(currentDigest)).toBeTruthy();
    expect(screen.getByText(/no packet contents/i)).toBeTruthy();
  });

  it("fails closed when the current receipt no longer matches the selected history entry", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cockpit_mission_history") {
        return Promise.resolve({
          ...baseHistory,
          returnedCount: 1,
          entries: [
            {
              ...baseHistory.entries[0],
              completion: {
                state: "completed",
                packetBacked: true,
                workPacketCount: 1,
                missionCompletionPacketPresent: true,
                receiptDigest: currentDigest,
              },
            },
          ],
        });
      }
      if (command === "cockpit_mission_completion") {
        return Promise.resolve({
          ...completedReceipt,
          completion: {
            ...completedReceipt.completion,
            receiptDigest: "d".repeat(64),
          },
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByRole("button", { name: "Inspect receipt" }));

    expect(await screen.findByText("Receipt unavailable")).toBeTruthy();
    expect(
      screen.getByText("The current durable receipt no longer matches this Mission history entry."),
    ).toBeTruthy();
  });

  it("shows truthful empty and durability failure states", async () => {
    tauriMocks.invoke.mockResolvedValueOnce({
      ...baseHistory,
      outcome: "empty",
      returnedCount: 0,
      entries: [],
    });
    const first = render(<MissionHistorySection repoPath="C:/empty" />);
    fireEvent.click(screen.getByText("Mission history"));
    expect(await screen.findByText("No durable Mission attempts for this repository.")).toBeTruthy();
    first.unmount();

    tauriMocks.invoke.mockRejectedValueOnce(new Error("Mission history durability is unavailable"));
    render(<MissionHistorySection repoPath="C:/broken" />);
    fireEvent.click(screen.getByText("Mission history"));
    expect(await screen.findByText("History unavailable")).toBeTruthy();
    expect(screen.getByText("Mission history durability is unavailable")).toBeTruthy();
  });

  it("keeps replay collapsed and performs no replay read when only Mission history opens", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cockpit_mission_history") return Promise.resolve(baseHistory);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));

    expect(await screen.findByText("Replay timeline")).toBeTruthy();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "cockpit_mission_replay_timeline",
      expect.anything(),
    );
  });

  it("reads and renders only the backend-projected replay checkpoint window on demand", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cockpit_mission_history") return Promise.resolve(baseHistory);
      if (command === "cockpit_mission_replay_timeline") return Promise.resolve(replayTimeline);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByText("Replay timeline"));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("cockpit_mission_replay_timeline", {
        repoPath: "C:/repo",
        limit: 20,
      }),
    );
    expect(await screen.findByText(timelineHash.slice(0, 16))).toBeTruthy();
    expect(screen.getByText("execution reserved")).toBeTruthy();
    expect(screen.getByText("review required")).toBeTruthy();
    expect(screen.getByText("1 running")).toBeTruthy();
    expect(screen.getAllByText("1 review").length).toBeGreaterThan(0);
    expect(screen.getByText(/Read-only · deterministic · restart-safe · 0 replay effects/i)).toBeTruthy();
    expect(screen.queryByText(/timeline-private-task/i)).toBeNull();
    expect(screen.queryByText(/hidden-attempt/i)).toBeNull();
  });

  it("copies only backend-returned timeline and checkpoint hashes", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cockpit_mission_history") return Promise.resolve(baseHistory);
      if (command === "cockpit_mission_replay_timeline") return Promise.resolve(replayTimeline);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByText("Replay timeline"));

    fireEvent.click(await screen.findByRole("button", { name: "Copy timeline hash" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(timelineHash));

    fireEvent.click(screen.getAllByRole("button", { name: "Copy checkpoint hash" })[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(checkpointHashOne));
  });

  it("loads older checkpoints explicitly and shows truthful not-found and failure states", async () => {
    const expandedTimeline = {
      ...replayTimeline,
      requestedLimit: 40,
      effectiveLimit: 40,
      timeline: {
        ...replayTimeline.timeline,
        returnedCheckpointCount: 4,
        returnedStartPosition: 0,
        hasMore: false,
        checkpoints: [
          {
            position: 0,
            eventKind: "mission_accepted",
            taskStatusCounts: { ready: 1 },
            completedWorkCount: 0,
            packetBackedMissionState: "incomplete",
            checkpointHash: "2".repeat(64),
          },
          {
            position: 1,
            eventKind: "task_created",
            taskStatusCounts: { ready: 1 },
            completedWorkCount: 0,
            packetBackedMissionState: "incomplete",
            checkpointHash: "3".repeat(64),
          },
          ...replayTimeline.timeline.checkpoints,
        ],
      },
    };
    tauriMocks.invoke.mockImplementation((command: string, args?: { limit?: number }) => {
      if (command === "cockpit_mission_history") return Promise.resolve(baseHistory);
      if (command === "cockpit_mission_replay_timeline") {
        return Promise.resolve(args?.limit === 40 ? expandedTimeline : replayTimeline);
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    const first = render(<MissionHistorySection repoPath="C:/repo" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByText("Replay timeline"));
    fireEvent.click(await screen.findByRole("button", { name: "Load older checkpoints" }));
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenLastCalledWith("cockpit_mission_replay_timeline", {
        repoPath: "C:/repo",
        limit: 40,
      }),
    );
    expect(await screen.findByText("4 checkpoints")).toBeTruthy();
    first.unmount();

    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cockpit_mission_history") return Promise.resolve(baseHistory);
      if (command === "cockpit_mission_replay_timeline") {
        return Promise.resolve({
          ...replayTimeline,
          outcome: "not_found",
          found: false,
          timeline: null,
          notFound: {
            code: "accepted_cockpit_mission_not_found",
            syntheticTimelineCreated: false,
          },
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    const second = render(<MissionHistorySection repoPath="C:/empty" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByText("Replay timeline"));
    expect(await screen.findByText("No accepted Mission is available for replay.")).toBeTruthy();
    second.unmount();

    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cockpit_mission_history") return Promise.resolve(baseHistory);
      if (command === "cockpit_mission_replay_timeline") {
        return Promise.reject(new Error("Mission replay timeline is inconsistent"));
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    render(<MissionHistorySection repoPath="C:/broken" />);
    fireEvent.click(screen.getByText("Mission history"));
    fireEvent.click(await screen.findByText("Replay timeline"));
    expect(await screen.findByText("Replay unavailable")).toBeTruthy();
    expect(screen.getByText("Mission replay timeline is inconsistent")).toBeTruthy();
  });
});
