import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrchestraDialog, showOrchestra, useOrchestraStore } from "../shared/ui/OrchestraDialog";

describe("OrchestraDialog", () => {
  afterEach(() => {
    useOrchestraStore.setState({ open: false, resolve: null });
    cleanup();
  });

  it("is closed initially", () => {
    const { queryByRole } = render(<OrchestraDialog />);
    expect(queryByRole("dialog")).toBeNull();
  });

  it("opens when show() is called and renders all 4 role options", async () => {
    const { getAllByRole, findByLabelText, findByPlaceholderText, getByText } = render(<OrchestraDialog />);
    let resultPromise: Promise<unknown> | null = null;
    act(() => {
      resultPromise = showOrchestra();
    });
    await findByPlaceholderText("What should the team work on?");
    await findByLabelText("Orchestra dispatch plan");
    const checkboxes = getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4);
    expect(getByText("Parallel lanes")).toBeTruthy();
    expect(getByText("3 lanes")).toBeTruthy();
    expect(getByText("Conflict")).toBeTruthy();
    // Cancel to drain the promise.
    act(() => {
      useOrchestraStore.getState().close(null);
    });
    await resultPromise;
  });

  it("default-selects implementer / tester / reviewer", async () => {
    const { getAllByRole, findByPlaceholderText } = render(<OrchestraDialog />);
    let resultPromise: Promise<unknown> | null = null;
    act(() => {
      resultPromise = showOrchestra();
    });
    await findByPlaceholderText("What should the team work on?");
    const checkboxes = getAllByRole("checkbox") as HTMLInputElement[];
    // Order matches ORCHESTRA_ROLES: implementer / tester / reviewer / documenter
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(true);
    expect(checkboxes[3].checked).toBe(false);
    act(() => {
      useOrchestraStore.getState().close(null);
    });
    await resultPromise;
  });

  it("close(null) resolves with null", async () => {
    render(<OrchestraDialog />);
    const p = showOrchestra();
    act(() => {
      useOrchestraStore.getState().close(null);
    });
    await expect(p).resolves.toBeNull();
  });

  it("close({task, roles}) resolves with the payload", async () => {
    render(<OrchestraDialog />);
    const p = showOrchestra();
    act(() => {
      useOrchestraStore.getState().close({
        task: "do it",
        roles: ["implementer"],
      });
    });
    await expect(p).resolves.toEqual({ task: "do it", roles: ["implementer"] });
  });
});
