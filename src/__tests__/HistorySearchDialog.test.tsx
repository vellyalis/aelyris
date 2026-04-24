import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HistorySearchDialog, showHistorySearch, useHistorySearchStore } from "../features/history/HistorySearchDialog";
import type { SearchHit } from "../shared/types/history";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

const hit = (command: string, score = 0.9, exit = 0): SearchHit => ({
  entry: {
    command_id: Math.floor(Math.random() * 10_000),
    command,
    cwd: "/repo",
    exit_code: exit,
    executed_at: "2026-04-18 10:00:00",
  },
  score,
});

describe("HistorySearchDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useHistorySearchStore.setState({ open: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("is closed initially", () => {
    const { queryByRole } = render(<HistorySearchDialog onAccept={() => {}} />);
    expect(queryByRole("dialog")).toBeNull();
  });

  it("opens via showHistorySearch and shows the placeholder", async () => {
    const { findByPlaceholderText } = render(<HistorySearchDialog onAccept={() => {}} />);
    act(() => {
      showHistorySearch();
    });
    const input = await findByPlaceholderText(/ビルドエラー/);
    expect(input).toBeDefined();
  });

  it("renders hits returned by semantic_search_history and calls onAccept on click", async () => {
    invokeMock.mockResolvedValue([hit("cargo test", 0.91)]);
    const onAccept = vi.fn();
    const { findByPlaceholderText, findByText } = render(<HistorySearchDialog onAccept={onAccept} />);
    act(() => {
      showHistorySearch();
    });
    const input = (await findByPlaceholderText(/ビルドエラー/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "cargo" } });

    const row = await findByText("cargo test");
    fireEvent.click(row);
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(onAccept.mock.calls[0][0].entry.command).toBe("cargo test");
    // Dialog auto-closes on accept.
    expect(useHistorySearchStore.getState().open).toBe(false);
  });

  it("Enter activates the highlighted hit", async () => {
    invokeMock.mockResolvedValue([hit("pnpm build", 0.8)]);
    const onAccept = vi.fn();
    const { findByPlaceholderText } = render(<HistorySearchDialog onAccept={onAccept} />);
    act(() => {
      showHistorySearch();
    });
    const input = (await findByPlaceholderText(/ビルドエラー/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "build" } });
    // Wait until the hook has populated hits.
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await waitFor(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAccept).toHaveBeenCalled();
    });
    expect(onAccept.mock.calls[0][0].entry.command).toBe("pnpm build");
  });

  it("toggles the failed-only filter", async () => {
    invokeMock.mockResolvedValue([]);
    const { findByPlaceholderText, getByText } = render(<HistorySearchDialog onAccept={() => {}} />);
    act(() => {
      showHistorySearch();
    });
    await findByPlaceholderText(/ビルドエラー/);
    const chip = getByText("failed only");
    fireEvent.click(chip);

    // Trigger a search so the hook re-fires with the filter.
    const input = (await findByPlaceholderText(/ビルドエラー/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "cargo" } });
    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c) => c[0] === "semantic_search_history");
      expect(call).toBeTruthy();
      expect((call![1] as { filters: { only_failed?: boolean } }).filters.only_failed).toBe(true);
    });
  });
});
