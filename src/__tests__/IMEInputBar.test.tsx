import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  IMEInputBar,
  type IMEInputBarHandle,
} from "../features/terminal/IMEInputBar";

function renderBar(
  props: Partial<React.ComponentProps<typeof IMEInputBar>> & {
    ref?: React.Ref<IMEInputBarHandle>;
  } = {},
) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const onRequestCanvasFocus = props.onRequestCanvasFocus ?? vi.fn();
  const rest = {
    autoFocus: props.autoFocus,
    maxHistory: props.maxHistory,
  };
  const utils = render(
    <IMEInputBar
      ref={props.ref}
      onSubmit={onSubmit}
      onRequestCanvasFocus={onRequestCanvasFocus}
      {...rest}
    />,
  );
  const textarea = utils.container.querySelector(
    "textarea",
  ) as HTMLTextAreaElement;
  return { ...utils, textarea, onSubmit, onRequestCanvasFocus };
}

describe("IMEInputBar", () => {
  it("submits the current value and \\r on Enter, then clears", () => {
    const { textarea, onSubmit } = renderBar();
    fireEvent.change(textarea, { target: { value: "echo hi" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("echo hi\r");
    expect(textarea.value).toBe("");
  });

  it("sends a bare \\r when Enter is pressed on an empty bar", () => {
    const { textarea, onSubmit } = renderBar();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("\r");
  });

  it("Shift+Enter inserts a newline instead of submitting", () => {
    const { textarea, onSubmit } = renderBar();
    fireEvent.change(textarea, { target: { value: "line1" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    // onSubmit is NOT called — the browser's default inserts the newline.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit while IME composition is active", () => {
    const { textarea, onSubmit } = renderBar();
    fireEvent.change(textarea, { target: { value: "きょう" } });
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Esc calls onRequestCanvasFocus", () => {
    const { textarea, onRequestCanvasFocus } = renderBar();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onRequestCanvasFocus).toHaveBeenCalled();
  });

  it("ArrowUp at buffer start recalls previous submission; ArrowDown advances / restores draft", () => {
    const { textarea, onSubmit } = renderBar();

    // Submit three commands to build history.
    for (const cmd of ["one", "two", "three"]) {
      fireEvent.change(textarea, { target: { value: cmd } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    }
    expect(onSubmit).toHaveBeenCalledTimes(3);

    // Start typing a draft, then Up/Down browse history.
    fireEvent.change(textarea, { target: { value: "draft" } });
    // Caret at start is the trigger for ↑.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("three");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("two");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("one");
    // ↑ at the oldest entry stays on it.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("one");
    // ↓ walks forward.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(textarea.value).toBe("two");
    // Walking off the end restores the original draft.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(textarea.value).toBe("three");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(textarea.value).toBe("draft");
  });

  it("caps history at maxHistory entries (FIFO)", () => {
    const { textarea, onSubmit } = renderBar({ maxHistory: 2 });
    for (const cmd of ["a", "b", "c"]) {
      fireEvent.change(textarea, { target: { value: cmd } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    }
    expect(onSubmit).toHaveBeenCalledTimes(3);

    // Only the last two should be recallable: 'b' then 'a' should NOT appear.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("c");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("b");
    // Third ↑ must not reveal 'a' — it was evicted.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("b");
  });

  it("deduplicates consecutive identical submissions in history", () => {
    const { textarea } = renderBar();
    for (const cmd of ["ls", "ls", "pwd"]) {
      fireEvent.change(textarea, { target: { value: cmd } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    }
    // History should be ['ls', 'pwd'] — the second 'ls' is merged.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("pwd");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("ls");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    // Oldest, no earlier entry.
    expect(textarea.value).toBe("ls");
  });

  it("indicator switches to あ during IME composition and back to A after commit", () => {
    const { textarea, container } = renderBar();
    const indicator = container.querySelector(
      "[aria-label='ASCII'], [aria-label='IME composing']",
    ) as HTMLElement;
    expect(indicator.textContent).toBe("A");
    fireEvent.compositionStart(textarea);
    expect(
      (
        container.querySelector(
          "[aria-label='IME composing']",
        ) as HTMLElement
      ).textContent,
    ).toBe("あ");
    fireEvent.compositionEnd(textarea);
    expect(
      (container.querySelector("[aria-label='ASCII']") as HTMLElement)
        .textContent,
    ).toBe("A");
  });

  it("imperative handle focus() moves keyboard focus into the textarea", () => {
    const ref = createRef<IMEInputBarHandle>();
    const { textarea } = renderBar({ ref });
    expect(document.activeElement).not.toBe(textarea);
    act(() => {
      ref.current?.focus();
    });
    expect(document.activeElement).toBe(textarea);
    expect(ref.current?.hasFocus()).toBe(true);
  });

  it("does not submit while browsing history — only free edits reset history pointer", () => {
    const { textarea, onSubmit } = renderBar();
    fireEvent.change(textarea, { target: { value: "ls -la" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("ls -la");
    // Typing in the middle should break "navigating history" state.
    fireEvent.change(textarea, { target: { value: "ls -lah" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith("ls -lah\r");
  });
});
