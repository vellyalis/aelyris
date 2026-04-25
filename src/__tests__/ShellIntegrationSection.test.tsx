import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ShellIntegrationSection,
  type ShellIntegrationStatus,
} from "../features/settings/ShellIntegrationSection";

const SAMPLE: ShellIntegrationStatus[] = [
  {
    shell: "powershell",
    label: "PowerShell",
    scriptPath: "C:/Users/x/.aether/shell-integration/aether.ps1",
    profilePath: "C:/Users/x/Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
    profileExists: true,
    installed: false,
    sourceLine: ". \"C:/Users/x/.aether/shell-integration/aether.ps1\"",
  },
  {
    shell: "bash",
    label: "Bash",
    scriptPath: "/home/x/.aether/shell-integration/aether.bash",
    profilePath: "/home/x/.bashrc",
    profileExists: true,
    installed: true,
    sourceLine: "source '/home/x/.aether/shell-integration/aether.bash'",
  },
];

describe("ShellIntegrationSection", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders one row per shell with installed badge reflecting status", async () => {
    const loadStatus = vi.fn().mockResolvedValue(SAMPLE);
    const { container } = render(
      <ShellIntegrationSection
        loadStatus={loadStatus}
        install={vi.fn()}
        copyToClipboard={vi.fn()}
      />,
    );
    await waitFor(() => expect(loadStatus).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelectorAll("[data-testid='shell-integration-section'] > div")).toHaveLength(2),
    );
    // Bash is marked installed.
    const bashRow = Array.from(container.querySelectorAll("div")).find((el) =>
      el.textContent?.startsWith("Bash"),
    ) as HTMLElement;
    expect(bashRow.textContent).toContain("Installed");
    // PowerShell is not.
    const psRow = Array.from(container.querySelectorAll("div")).find((el) =>
      el.textContent?.startsWith("PowerShell"),
    ) as HTMLElement;
    expect(psRow.textContent).toContain("Not installed");
  });

  it("install click triggers IPC and surfaces appended feedback", async () => {
    const loadStatus = vi
      .fn<() => Promise<ShellIntegrationStatus[]>>()
      .mockResolvedValueOnce(SAMPLE)
      .mockResolvedValue(
        SAMPLE.map((s) => (s.shell === "powershell" ? { ...s, installed: true } : s)),
      );
    const install = vi.fn().mockResolvedValue({
      appended: true,
      profilePath: "C:/Users/x/Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
      sourceLine: SAMPLE[0].sourceLine,
    });

    const { container } = render(
      <ShellIntegrationSection
        loadStatus={loadStatus}
        install={install}
        copyToClipboard={vi.fn()}
      />,
    );
    await waitFor(() => expect(loadStatus).toHaveBeenCalledTimes(1));

    const psRow = Array.from(container.querySelectorAll("div")).find((el) =>
      el.textContent?.startsWith("PowerShell"),
    ) as HTMLElement;
    const installBtn = Array.from(psRow.querySelectorAll("button")).find(
      (b) => b.textContent === "Install",
    ) as HTMLButtonElement;
    expect(installBtn).not.toBeUndefined();

    await act(async () => {
      fireEvent.click(installBtn);
    });

    await waitFor(() => expect(install).toHaveBeenCalledWith("powershell"));
    // Refresh after install — second loadStatus call should hit.
    await waitFor(() => expect(loadStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const refreshedRow = Array.from(container.querySelectorAll("div")).find((el) =>
        el.textContent?.startsWith("PowerShell"),
      ) as HTMLElement;
      expect(refreshedRow.textContent).toContain("Appended to");
    });
  });

  it("install on already-installed shell reports a no-op without scaring the user", async () => {
    const loadStatus = vi.fn().mockResolvedValue(SAMPLE);
    const install = vi.fn().mockResolvedValue({
      appended: false,
      profilePath: "/home/x/.bashrc",
      sourceLine: SAMPLE[1].sourceLine,
    });

    const { container } = render(
      <ShellIntegrationSection
        loadStatus={loadStatus}
        install={install}
        copyToClipboard={vi.fn()}
      />,
    );
    await waitFor(() => expect(loadStatus).toHaveBeenCalled());

    const bashRow = Array.from(container.querySelectorAll("div")).find((el) =>
      el.textContent?.startsWith("Bash"),
    ) as HTMLElement;
    const reinstallBtn = Array.from(bashRow.querySelectorAll("button")).find(
      (b) => b.textContent === "Reinstall",
    ) as HTMLButtonElement;
    expect(reinstallBtn).not.toBeUndefined();

    await act(async () => {
      fireEvent.click(reinstallBtn);
    });

    await waitFor(() => {
      const refreshedRow = Array.from(container.querySelectorAll("div")).find((el) =>
        el.textContent?.startsWith("Bash"),
      ) as HTMLElement;
      expect(refreshedRow.textContent).toContain("Already installed");
    });
  });

  it("copy click forwards the source line to the clipboard adapter", async () => {
    const loadStatus = vi.fn().mockResolvedValue(SAMPLE);
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <ShellIntegrationSection
        loadStatus={loadStatus}
        install={vi.fn()}
        copyToClipboard={copyToClipboard}
      />,
    );
    await waitFor(() => expect(loadStatus).toHaveBeenCalled());

    const psRow = Array.from(container.querySelectorAll("div")).find((el) =>
      el.textContent?.startsWith("PowerShell"),
    ) as HTMLElement;
    const copyBtn = Array.from(psRow.querySelectorAll("button")).find(
      (b) => b.textContent === "Copy line",
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(SAMPLE[0].sourceLine));
    await waitFor(() => {
      const refreshedRow = Array.from(container.querySelectorAll("div")).find((el) =>
        el.textContent?.startsWith("PowerShell"),
      ) as HTMLElement;
      expect(refreshedRow.textContent).toContain("Copied to clipboard");
    });
  });

  it("surfaces install failures so the user can react", async () => {
    const loadStatus = vi.fn().mockResolvedValue(SAMPLE);
    const install = vi.fn().mockRejectedValue(new Error("permission denied"));

    const { container } = render(
      <ShellIntegrationSection
        loadStatus={loadStatus}
        install={install}
        copyToClipboard={vi.fn()}
      />,
    );
    await waitFor(() => expect(loadStatus).toHaveBeenCalled());

    const psRow = Array.from(container.querySelectorAll("div")).find((el) =>
      el.textContent?.startsWith("PowerShell"),
    ) as HTMLElement;
    const installBtn = Array.from(psRow.querySelectorAll("button")).find(
      (b) => b.textContent === "Install",
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(installBtn);
    });

    await waitFor(() => {
      const refreshedRow = Array.from(container.querySelectorAll("div")).find((el) =>
        el.textContent?.startsWith("PowerShell"),
      ) as HTMLElement;
      expect(refreshedRow.textContent).toContain("Install failed");
      expect(refreshedRow.textContent).toContain("permission denied");
    });
  });
});
