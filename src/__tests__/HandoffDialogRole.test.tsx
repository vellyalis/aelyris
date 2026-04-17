import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  HandoffDialog,
  showHandoff,
  useHandoffStore,
} from "../shared/ui/HandoffDialog";

describe("HandoffDialog role selection", () => {
  afterEach(() => {
    useHandoffStore.setState({ open: false, resolve: null });
    cleanup();
  });

  it("renders a role dropdown with ad-hoc default when no role is preselected", async () => {
    const { findByLabelText } = render(<HandoffDialog />);
    const p = showHandoff({ sourceName: "impl", defaultPrompt: "go" });
    const sel = (await findByLabelText("Target Orchestra role")) as HTMLSelectElement;
    expect(sel.value).toBe(""); // "— none —"
    act(() => {
      useHandoffStore.getState().close(null);
    });
    await p;
  });

  it("preselects the provided defaultRole", async () => {
    const { findByLabelText } = render(<HandoffDialog />);
    const p = showHandoff({
      sourceName: "impl",
      defaultPrompt: "go",
      defaultRole: "reviewer",
    });
    const sel = (await findByLabelText("Target Orchestra role")) as HTMLSelectElement;
    expect(sel.value).toBe("reviewer");
    act(() => {
      useHandoffStore.getState().close(null);
    });
    await p;
  });

  it("resolves with role=null when the user keeps the ad-hoc option", async () => {
    render(<HandoffDialog />);
    const p = showHandoff({ sourceName: "src", defaultPrompt: "x" });
    act(() => {
      useHandoffStore.getState().close({
        prompt: "x",
        modelId: "claude-sonnet",
        role: null,
      });
    });
    await expect(p).resolves.toEqual({
      prompt: "x",
      modelId: "claude-sonnet",
      role: null,
    });
  });

  it("resolves with the selected role when one is chosen", async () => {
    render(<HandoffDialog />);
    const p = showHandoff({ sourceName: "src", defaultPrompt: "x" });
    act(() => {
      useHandoffStore.getState().close({
        prompt: "x",
        modelId: "claude-sonnet",
        role: "tester",
      });
    });
    await expect(p).resolves.toMatchObject({ role: "tester" });
  });
});
