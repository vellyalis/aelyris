import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrchestraDialog, showOrchestra, useOrchestraStore } from "../shared/ui/OrchestraDialog";

describe("OrchestraDialog", () => {
  afterEach(() => {
    useOrchestraStore.setState({
      open: false,
      resolve: null,
      activeClaimCount: 0,
      ownershipUnavailable: false,
    });
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

  it("warns that parallel lanes are NOT conflict-free when active symbol claims exist", async () => {
    const { findByPlaceholderText } = render(<OrchestraDialog />);
    let resultPromise: Promise<unknown> | null = null;
    act(() => {
      resultPromise = showOrchestra({ activeClaimCount: 2 });
    });
    await findByPlaceholderText("What should the team work on?");
    // The dialog must NOT present parallel lanes as safe when others hold live claims.
    expect(document.body.textContent).toContain("2 active symbol claim");
    expect(document.body.textContent).toContain("parallel lanes are NOT conflict-free");
    act(() => {
      useOrchestraStore.getState().close(null);
    });
    await resultPromise;
  });

  it("shows no claim warning when there are zero active claims", async () => {
    const { findByPlaceholderText } = render(<OrchestraDialog />);
    let resultPromise: Promise<unknown> | null = null;
    act(() => {
      resultPromise = showOrchestra({ activeClaimCount: 0 });
    });
    await findByPlaceholderText("What should the team work on?");
    expect(document.body.textContent).not.toContain("active symbol claim");
    act(() => {
      useOrchestraStore.getState().close(null);
    });
    await resultPromise;
  });

  it("warns that safety is UNKNOWN (not parallel-safe) when the ownership map is unavailable", async () => {
    const { findByPlaceholderText } = render(<OrchestraDialog />);
    let resultPromise: Promise<unknown> | null = null;
    act(() => {
      // A real backend failure: claimCount is 0 only because the read FAILED — the
      // dialog must NOT present that as "no claims / parallel-safe".
      resultPromise = showOrchestra({ activeClaimCount: 0, ownershipUnavailable: true });
    });
    await findByPlaceholderText("What should the team work on?");
    expect(document.body.textContent).toContain("Could not read the symbol-ownership map");
    expect(document.body.textContent).toContain("NOT verified conflict-free");
    // It must NOT also render the zero-claim "all clear" path.
    expect(document.body.textContent).not.toContain("active symbol claim");
    act(() => {
      useOrchestraStore.getState().close(null);
    });
    await resultPromise;
  });
});
