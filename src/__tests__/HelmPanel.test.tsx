import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { HelmPanel } from "../features/helm/HelmPanel";

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
    localStorage.setItem("aether:helm:tasks", JSON.stringify([{ id: "t-1", label: "Test task", done: false }]));
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

  it("deletes task on delete-button click", () => {
    localStorage.setItem("aether:helm:tasks", JSON.stringify([{ id: "t-1", label: "Delete me", done: false }]));
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
    const saved = JSON.parse(localStorage.getItem("aether:helm:tasks") ?? "[]");
    expect(saved.length).toBe(1);
    expect(saved[0].label).toBe("Saved task");
    expect(saved[0].done).toBe(false);
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
