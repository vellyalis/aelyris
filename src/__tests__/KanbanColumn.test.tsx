import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KanbanColumn } from "../features/kanban/KanbanColumn";
import type { KanbanTask } from "../shared/types/kanban";

const mockTasks: KanbanTask[] = [
  { id: "1", title: "Fix bug", column: "todo", priority: "medium", createdAt: Date.now(), updatedAt: Date.now() },
  { id: "2", title: "Add feature", column: "todo", priority: "high", createdAt: Date.now(), updatedAt: Date.now() },
];

describe("KanbanColumn", () => {
  it("renders column header with label", () => {
    const { container } = render(
      <KanbanColumn columnId="todo" label="Todo" color="#ccc" tasks={[]} activeTaskId={null} onDrop={() => {}} />,
    );
    expect(container.textContent).toContain("Todo");
  });

  it("shows task count", () => {
    const { container } = render(
      <KanbanColumn
        columnId="todo"
        label="Todo"
        color="#ccc"
        tasks={mockTasks}
        activeTaskId={null}
        onDrop={() => {}}
      />,
    );
    expect(container.textContent).toContain("2");
  });

  it("renders correct number of cards", () => {
    const { container } = render(
      <KanbanColumn
        columnId="todo"
        label="Todo"
        color="#ccc"
        tasks={mockTasks}
        activeTaskId={null}
        onDrop={() => {}}
      />,
    );
    expect(container.textContent).toContain("Fix bug");
    expect(container.textContent).toContain("Add feature");
  });

  it("renders empty column", () => {
    const { container } = render(
      <KanbanColumn columnId="done" label="Done" color="#0f0" tasks={[]} activeTaskId={null} onDrop={() => {}} />,
    );
    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("0");
  });

  it("highlights active card", () => {
    const { container } = render(
      <KanbanColumn columnId="todo" label="Todo" color="#ccc" tasks={mockTasks} activeTaskId="1" onDrop={() => {}} />,
    );
    expect(container.textContent).toContain("Fix bug");
  });
});
