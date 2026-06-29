import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HelmPanel } from "../features/helm/HelmPanel";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";

function collectFallbackEvents() {
  const events: FallbackTelemetryDetail[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
  };
  window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
  return {
    events,
    cleanup: () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener),
  };
}

beforeEach(() => {
  localStorage.clear();
});

function requiredElement<T extends Element>(element: T | null, label: string): T {
  if (!element) throw new Error(`Expected ${label} to exist`);
  return element;
}

describe("HelmPanel", () => {
  it("renders with no tasks", () => {
    const { container } = render(<HelmPanel />);
    expect(container.textContent).toContain("No tasks");
    expect(container.textContent).toContain("Tasks");
  });

  it("shows input when + clicked", () => {
    const { container } = render(<HelmPanel />);
    const addBtn = requiredElement(container.querySelector('button[aria-label="Add task"]'), "add task button");
    fireEvent.click(addBtn);
    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.getAttribute("placeholder")).toBe("Add task...");
  });

  it("adds task on Enter", () => {
    const { container } = render(<HelmPanel />);
    // Click +
    fireEvent.click(requiredElement(container.querySelector('button[aria-label="Add task"]'), "add task button"));
    // Type task name
    const input = requiredElement(container.querySelector("input"), "task input");
    fireEvent.change(input, { target: { value: "My task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Task should appear
    expect(container.textContent).toContain("My task");
    // Count should show
    expect(container.textContent).toContain("0/1");
  });

  it("toggles task done on checkbox click", () => {
    // Pre-populate localStorage
    localStorage.setItem("aelyris:helm:tasks", JSON.stringify([{ id: "t-1", label: "Test task", done: false }]));
    const { container } = render(<HelmPanel />);
    // Native `<input type=checkbox>` was replaced by a `role=checkbox`
    // button (Lucide Circle / CircleCheck — Apple Reminders pattern).
    // The query has to follow.
    const checkbox = container.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(checkbox);
    expect(container.textContent).toContain("1/1");
    const after = container.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    expect(after.getAttribute("aria-checked")).toBe("true");
  });

  it("drops malformed persisted tasks instead of crashing the rail", () => {
    localStorage.setItem("aelyris:helm:tasks", JSON.stringify({ id: "not-an-array" }));
    const { container } = render(<HelmPanel />);
    expect(container.textContent).toContain("No tasks");

    localStorage.setItem(
      "aelyris:helm:tasks",
      JSON.stringify([{ id: "t-1", label: "Valid", done: true }, { id: 2, label: "Invalid" }, null]),
    );
    const second = render(<HelmPanel />);
    expect(second.container.textContent).toContain("Valid");
    expect(second.container.textContent).toContain("1/1");
  });

  it("deletes task on delete-button click", () => {
    localStorage.setItem("aelyris:helm:tasks", JSON.stringify([{ id: "t-1", label: "Delete me", done: false }]));
    const { container } = render(<HelmPanel />);
    expect(container.textContent).toContain("Delete me");
    // Lucide X replaced the raw "×" glyph — locate by aria-label instead.
    const deleteBtn = requiredElement(
      container.querySelector('button[aria-label^="Delete task"]'),
      "delete task button",
    );
    fireEvent.click(deleteBtn);
    expect(container.textContent).not.toContain("Delete me");
    expect(container.textContent).toContain("No tasks");
  });

  it("persists tasks to localStorage", () => {
    const { container } = render(<HelmPanel />);
    fireEvent.click(requiredElement(container.querySelector("button"), "add task button"));
    const input = requiredElement(container.querySelector("input"), "task input");
    fireEvent.change(input, { target: { value: "Saved task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Check localStorage
    const saved = JSON.parse(localStorage.getItem("aelyris:helm:tasks") ?? "[]");
    expect(saved.length).toBe(1);
    expect(saved[0].label).toBe("Saved task");
    expect(saved[0].done).toBe(false);
  });

  it("reports task persistence failures instead of silently losing Helm tasks", () => {
    const telemetry = collectFallbackEvents();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      const { container } = render(<HelmPanel />);
      fireEvent.click(requiredElement(container.querySelector("button"), "add task button"));
      const input = requiredElement(container.querySelector("input"), "task input");
      fireEvent.change(input, { target: { value: "Unsaved task" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(container.textContent).toContain("Unsaved task");
      expect(telemetry.events).toContainEqual(
        expect.objectContaining({
          source: "helm-tasks",
          operation: "persist_helm_tasks",
          userVisible: true,
        }),
      );
    } finally {
      setItem.mockRestore();
      telemetry.cleanup();
    }
  });

  it("cancels adding on Escape", () => {
    const { container } = render(<HelmPanel />);
    fireEvent.click(requiredElement(container.querySelector("button"), "add task button"));
    const input = requiredElement(container.querySelector("input"), "task input");
    fireEvent.keyDown(input, { key: "Escape" });
    // Input should be gone
    expect(container.querySelector("input")).toBeNull();
  });
});
