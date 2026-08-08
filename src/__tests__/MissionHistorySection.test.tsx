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
    expect(screen.getByText("On demand")).toBeTruthy();
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
});
