import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpdateCheckSection, type UpdateProbe } from "../features/settings/UpdateCheckSection";

describe("UpdateCheckSection", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the button without a result until clicked", () => {
    const checkUpdate = vi.fn<() => Promise<UpdateProbe>>();
    const { container } = render(<UpdateCheckSection checkUpdate={checkUpdate} />);
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.textContent).toBe("Check for updates");
    expect(checkUpdate).not.toHaveBeenCalled();
  });

  it("surfaces 'available' result with both versions", async () => {
    const checkUpdate = vi.fn<() => Promise<UpdateProbe>>().mockResolvedValue({
      kind: "available",
      version: "0.2.3",
      currentVersion: "0.2.2",
    });
    const { container } = render(<UpdateCheckSection checkUpdate={checkUpdate} />);
    const btn = container.querySelector("button") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(container.textContent).toContain("Update available: 0.2.3"));
    expect(container.textContent).toContain("current 0.2.2");
  });

  it("surfaces 'current' result with the running version", async () => {
    const checkUpdate = vi
      .fn<() => Promise<UpdateProbe>>()
      .mockResolvedValue({ kind: "current", currentVersion: "0.2.3" });
    const { container } = render(<UpdateCheckSection checkUpdate={checkUpdate} />);
    const btn = container.querySelector("button") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(container.textContent).toContain("You are on the latest version (0.2.3)"));
  });

  it("surfaces error messages verbatim so misconfiguration is visible here", async () => {
    const checkUpdate = vi
      .fn<() => Promise<UpdateProbe>>()
      .mockResolvedValue({ kind: "error", message: "could not fetch latest.json" });
    const { container } = render(<UpdateCheckSection checkUpdate={checkUpdate} />);
    const btn = container.querySelector("button") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(container.textContent).toContain("Check failed: could not fetch latest.json"));
  });
});
