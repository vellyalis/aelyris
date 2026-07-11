import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCMPanel } from "../features/scm/SCMPanel";
import { useToastStore } from "../shared/store/toastStore";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("SCMPanel status errors", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("repository unavailable"));
    useToastStore.setState({ toasts: [] });
  });

  it("surfaces git_status failures inline and as an error toast", async () => {
    const { findByRole, queryByText } = render(<SCMPanel projectPath="C:/repo" />);

    expect((await findByRole("alert")).textContent).toContain("Git status failed: repository unavailable");
    expect(queryByText("Working tree clean")).toBeNull();
    await waitFor(() => {
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        type: "error",
        title: "Source control unavailable",
        description: "repository unavailable",
      });
    });
  });
});
