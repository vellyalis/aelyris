// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampImeBarCandidateX,
  clampImeBarCandidateY,
  IMEInputBar,
  type IMEInputBarHandle,
  measureTextareaImeAnchor,
} from "../features/terminal/IMEInputBar";
import { useAppStore } from "../shared/store/appStore";

const invokeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const showConfirmMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../shared/ui/ConfirmDialog", () => ({
  showConfirm: showConfirmMock,
}));

const imeInputBarCssSource = readFileSync("src/features/terminal/IMEInputBar.module.css", "utf8");

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
    disabled: props.disabled,
    collapsed: props.collapsed,
    pickAttachmentFiles: props.pickAttachmentFiles,
    saveClipboardImage: props.saveClipboardImage,
    readNativeClipboardImage: props.readNativeClipboardImage,
  };
  const utils = render(
    <IMEInputBar ref={props.ref} onSubmit={onSubmit} onRequestCanvasFocus={onRequestCanvasFocus} {...rest} />,
  );
  const textarea = utils.container.querySelector("textarea") as HTMLTextAreaElement;
  return { ...utils, textarea, onSubmit, onRequestCanvasFocus };
}

describe("IMEInputBar", () => {
  afterEach(() => {
    invokeMock.mockClear();
    showConfirmMock.mockReset();
    showConfirmMock.mockResolvedValue(true);
    useAppStore.getState().setPasteGuard(true);
    vi.restoreAllMocks();
  });

  it("keeps compact pane footers from expanding wider than their pane", () => {
    expect(imeInputBarCssSource).toContain("min-inline-size: 0");
    expect(imeInputBarCssSource).toContain("width: 100%");
    expect(imeInputBarCssSource).toContain("max-width: 100%");
    expect(imeInputBarCssSource).toContain("container-type: inline-size");
    expect(imeInputBarCssSource).toContain(".bar.focused .input");
    expect(imeInputBarCssSource).toContain("@container (max-width: 220px)");
  });

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

  it("collapses visually while keeping the textarea mounted", () => {
    const { container, textarea } = renderBar({ collapsed: true });
    expect(container.querySelector("[aria-label='ターミナル入力バー']")?.getAttribute("data-collapsed")).toBe("true");
    expect(textarea).toBeTruthy();
  });

  it("stays expanded when the parent reports the pane as focused", () => {
    const { container } = renderBar({ collapsed: false });
    expect(container.querySelector("[aria-label='ターミナル入力バー']")?.getAttribute("data-collapsed")).toBe("false");
  });

  it("expands on textarea focus even when the parent requests collapse", () => {
    const { container, textarea } = renderBar({ collapsed: true });
    fireEvent.focus(textarea);
    expect(container.querySelector("[aria-label='ターミナル入力バー']")?.getAttribute("data-collapsed")).toBe("false");
  });

  it("expands while composing even when the parent requests collapse", () => {
    const { container, textarea } = renderBar({ collapsed: true });
    fireEvent.compositionStart(textarea);
    expect(container.querySelector("[aria-label='ターミナル入力バー']")?.getAttribute("data-collapsed")).toBe("false");
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

  it("previews multi-line paste and submits byte-identical normalized content after confirmation", async () => {
    const { textarea, onSubmit } = renderBar();
    const pasted = "echo one\r\necho two\nthird";

    fireEvent.paste(textarea, {
      clipboardData: { files: [], items: [], getData: () => pasted },
    });

    await waitFor(() => expect(showConfirmMock).toHaveBeenCalledTimes(1));
    expect(showConfirmMock).toHaveBeenCalledWith({
      title: "Run 3 pasted lines?",
      description: "echo one\necho two\nthird",
      confirmLabel: "Run",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("echo one\recho two\rthird"));
  });

  it("does not submit multi-line paste when confirmation is cancelled", async () => {
    showConfirmMock.mockResolvedValueOnce(false);
    const { textarea, onSubmit } = renderBar();

    fireEvent.paste(textarea, {
      clipboardData: { files: [], items: [], getData: () => "echo one\necho two" },
    });

    await waitFor(() => expect(showConfirmMock).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("passes single-line paste through without a dialog", () => {
    const { textarea, onSubmit } = renderBar();

    fireEvent.paste(textarea, {
      clipboardData: { files: [], items: [], getData: () => "echo one" },
    });

    expect(showConfirmMock).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits multi-line paste without a dialog when the guard setting is off", async () => {
    useAppStore.getState().setPasteGuard(false);
    const { textarea, onSubmit } = renderBar();

    fireEvent.paste(textarea, {
      clipboardData: { files: [], items: [], getData: () => "echo one\necho two" },
    });

    expect(showConfirmMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("echo one\recho two"));
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
    const indicator = container.querySelector("[aria-label='ASCII'], [aria-label='IME composing']") as HTMLElement;
    expect(indicator.textContent).toBe("A");
    fireEvent.compositionStart(textarea);
    expect((container.querySelector("[aria-label='IME composing']") as HTMLElement).textContent).toBe("あ");
    fireEvent.compositionEnd(textarea);
    expect((container.querySelector("[aria-label='ASCII']") as HTMLElement).textContent).toBe("A");
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

  it("disabled state prevents imperative focus and Enter submit", () => {
    const ref = createRef<IMEInputBarHandle>();
    const { textarea, onSubmit } = renderBar({ ref, disabled: true });
    expect(textarea.disabled).toBe(true);

    act(() => {
      ref.current?.focus();
    });
    expect(document.activeElement).not.toBe(textarea);

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("anchors IME candidates to the textarea caret, not the input's left edge", () => {
    const { textarea } = renderBar();
    fireEvent.change(textarea, { target: { value: "0123456789あいうえお" } });
    textarea.setSelectionRange(8, 8);

    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 700,
      bottom: 230,
      width: 600,
      height: 30,
      toJSON: () => ({}),
    } as DOMRect);

    const offsetLeftDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetLeft");
    const offsetTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.imeCaretMarker === "true" ? 96 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.imeCaretMarker === "true" ? 18 : 0;
      },
    });

    try {
      const anchor = measureTextareaImeAnchor(textarea);
      expect(anchor?.x).toBe(196);
      expect(anchor?.y).toBeGreaterThan(218);

      fireEvent.compositionStart(textarea);
      expect(invokeMock).toHaveBeenCalledWith(
        "set_ime_position",
        expect.objectContaining({
          x: 196,
          candidateX: 196,
        }),
      );
    } finally {
      if (offsetLeftDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetLeft", offsetLeftDescriptor);
      }
      if (offsetTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetTop", offsetTopDescriptor);
      }
    }
  });

  it("keeps IME candidates inside the input bar when the caret is near the right edge", () => {
    expect(clampImeBarCandidateX(660, 100, 700)).toBe(260);
    expect(clampImeBarCandidateX(180, 100, 700)).toBe(180);
  });

  it("keeps IME candidates above the viewport bottom", () => {
    expect(clampImeBarCandidateY(760, 800)).toBe(540);
    expect(clampImeBarCandidateY(240, 800)).toBe(240);
  });

  it("adds selected file paths into the composer where the user can edit before submit", async () => {
    const pickAttachmentFiles = vi.fn().mockResolvedValue(["C:\\Users\\user\\Pictures\\shot one.png"]);
    const { textarea, getByLabelText, getByText } = renderBar({ pickAttachmentFiles });

    fireEvent.click(getByLabelText("写真とファイルを追加"));

    await waitFor(() => {
      expect(textarea.value).toBe('"C:\\Users\\user\\Pictures\\shot one.png"');
    });
    expect(getByText("shot one.png")).toBeTruthy();
  });

  it("shows a compact attachment error without breaking the composer", async () => {
    const pickAttachmentFiles = vi.fn().mockRejectedValue(new Error("dialog unavailable"));
    const { textarea, getByLabelText, getByRole } = renderBar({ pickAttachmentFiles });

    fireEvent.click(getByLabelText("写真とファイルを追加"));

    await waitFor(() => {
      expect(getByRole("status").textContent).toBe("dialog unavailable");
    });
    expect(textarea.value).toBe("");
  });

  it("removes attachment chips from both the visible list and the composer text", async () => {
    const pickAttachmentFiles = vi.fn().mockResolvedValue(["C:\\Users\\user\\Pictures\\shot one.png"]);
    const { textarea, getByLabelText, queryByText } = renderBar({ pickAttachmentFiles });

    fireEvent.click(getByLabelText("写真とファイルを追加"));
    await waitFor(() => expect(queryByText("shot one.png")).toBeTruthy());

    fireEvent.click(getByLabelText("shot one.png を削除"));

    expect(queryByText("shot one.png")).toBeNull();
    expect(textarea.value).toBe("");
  });

  it("clears attachment chips after submit", async () => {
    const pickAttachmentFiles = vi.fn().mockResolvedValue(["C:\\Users\\user\\Pictures\\shot one.png"]);
    const { textarea, getByLabelText, queryByText } = renderBar({ pickAttachmentFiles });

    fireEvent.click(getByLabelText("写真とファイルを追加"));
    await waitFor(() => expect(queryByText("shot one.png")).toBeTruthy());

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(queryByText("shot one.png")).toBeNull();
    expect(textarea.value).toBe("");
  });

  it("saves pasted clipboard images and inserts the temp image path", async () => {
    const saveClipboardImage = vi.fn().mockResolvedValue("C:\\Temp\\aelyris-chat-images\\clip.png");
    const { textarea } = renderBar({ saveClipboardImage });
    const image = new File(["png"], "clip.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [image],
        items: [],
      },
    });

    await waitFor(() => {
      expect(saveClipboardImage).toHaveBeenCalledWith(expect.stringContaining("data:image/png"));
      expect(textarea.value).toBe('"C:\\Temp\\aelyris-chat-images\\clip.png"');
    });
  });

  it("uses native clipboard image IPC for the explicit clipboard button", async () => {
    const readNativeClipboardImage = vi.fn().mockResolvedValue("C:\\Temp\\aelyris-chat-images\\native.bmp");
    const saveClipboardImage = vi.fn();
    const { textarea, getByLabelText } = renderBar({ readNativeClipboardImage, saveClipboardImage });

    fireEvent.click(getByLabelText("クリップボード画像を追加"));

    await waitFor(() => {
      expect(readNativeClipboardImage).toHaveBeenCalledTimes(1);
      expect(textarea.value).toBe('"C:\\Temp\\aelyris-chat-images\\native.bmp"');
    });
    expect(saveClipboardImage).not.toHaveBeenCalled();
  });

  it("ignores repeated clipboard image paste while a save is already in flight", async () => {
    let resolveSave!: (path: string) => void;
    const saveClipboardImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { textarea } = renderBar({ saveClipboardImage });
    const image = new File(["png"], "clip.png", { type: "image/png" });
    const paste = {
      clipboardData: {
        files: [image],
        items: [],
      },
    };

    fireEvent.paste(textarea, paste);
    fireEvent.paste(textarea, paste);

    await waitFor(() => expect(saveClipboardImage).toHaveBeenCalledTimes(1));
    resolveSave("C:\\Temp\\aelyris-chat-images\\clip.png");
    await waitFor(() => expect(textarea.value).toBe('"C:\\Temp\\aelyris-chat-images\\clip.png"'));
  });

  it("reports clipboard image save failures without leaving stale chips", async () => {
    const saveClipboardImage = vi.fn().mockRejectedValue(new Error("save failed"));
    const { textarea, getByRole, queryByText } = renderBar({ saveClipboardImage });
    const image = new File(["png"], "clip.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [image],
        items: [],
      },
    });

    await waitFor(() => {
      expect(getByRole("status").textContent).toBe("save failed");
    });
    expect(queryByText("clip.png")).toBeNull();
    expect(textarea.value).toBe("");
  });
});
