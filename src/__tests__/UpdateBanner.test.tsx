import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpdateBanner, type UpdateState } from "../features/app/UpdateBanner";

describe("UpdateBanner", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when no update is available", async () => {
    const checkUpdate = vi.fn<() => Promise<UpdateState>>().mockResolvedValue({ available: false });
    const { container } = render(
      <UpdateBanner checkUpdate={checkUpdate} relaunch={vi.fn()} />,
    );
    await waitFor(() => expect(checkUpdate).toHaveBeenCalledTimes(1));
    // The banner should never appear in this branch.
    await waitFor(() => expect(container.querySelector("[role='status']")).toBeNull());
  });

  it("stays silent on check errors so a misconfigured endpoint does not nag", async () => {
    const checkUpdate = vi
      .fn<() => Promise<UpdateState>>()
      .mockRejectedValue(new Error("network unreachable"));
    const { container } = render(
      <UpdateBanner checkUpdate={checkUpdate} relaunch={vi.fn()} />,
    );
    await waitFor(() => expect(checkUpdate).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("renders banner with version + current when an update is available", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const checkUpdate = vi.fn<() => Promise<UpdateState>>().mockResolvedValue({
      available: true,
      version: "0.2.3",
      currentVersion: "0.2.2",
      downloadAndInstall,
    });

    const { container } = render(
      <UpdateBanner checkUpdate={checkUpdate} relaunch={vi.fn()} />,
    );
    const banner = await waitFor(() => {
      const el = container.querySelector("[role='status']");
      if (!el) throw new Error("banner not yet rendered");
      return el as HTMLElement;
    });
    expect(banner.textContent).toContain("0.2.3");
    expect(banner.textContent).toContain("current 0.2.2");
  });

  it("install click triggers download + relaunch", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const relaunch = vi.fn().mockResolvedValue(undefined);
    const checkUpdate = vi.fn<() => Promise<UpdateState>>().mockResolvedValue({
      available: true,
      version: "0.2.3",
      currentVersion: "0.2.2",
      downloadAndInstall,
    });

    const { container } = render(<UpdateBanner checkUpdate={checkUpdate} relaunch={relaunch} />);
    const banner = await waitFor(() => {
      const el = container.querySelector("[role='status']");
      if (!el) throw new Error("banner not rendered");
      return el as HTMLElement;
    });
    const installBtn = Array.from(banner.querySelectorAll("button")).find(
      (b) => b.textContent === "Install & restart",
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(installBtn);
    });

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
  });

  it("dismiss hides the banner without affecting downloadAndInstall", async () => {
    const downloadAndInstall = vi.fn();
    const checkUpdate = vi.fn<() => Promise<UpdateState>>().mockResolvedValue({
      available: true,
      version: "0.2.3",
      currentVersion: "0.2.2",
      downloadAndInstall,
    });

    const { container } = render(
      <UpdateBanner checkUpdate={checkUpdate} relaunch={vi.fn()} />,
    );
    const banner = await waitFor(() => {
      const el = container.querySelector("[role='status']");
      if (!el) throw new Error("banner not rendered");
      return el as HTMLElement;
    });
    const dismissBtn = Array.from(banner.querySelectorAll("button")).find(
      (b) => b.textContent === "Dismiss",
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    await waitFor(() => expect(container.querySelector("[role='status']")).toBeNull());
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("disableAutoCheck prevents the initial check", async () => {
    const checkUpdate = vi.fn<() => Promise<UpdateState>>().mockResolvedValue({ available: false });
    render(<UpdateBanner checkUpdate={checkUpdate} relaunch={vi.fn()} disableAutoCheck />);
    await new Promise((r) => setTimeout(r, 0));
    expect(checkUpdate).not.toHaveBeenCalled();
  });
});
