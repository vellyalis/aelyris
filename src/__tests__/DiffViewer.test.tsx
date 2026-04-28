import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const diffEditorMock = vi.hoisted(() => ({
  mounted: false,
  mouseDown: null as null | ((event: { target: { type: number; position?: { lineNumber: number } } }) => void),
  defineTheme: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: {
    beforeMount?: (monaco: { editor: { defineTheme: typeof diffEditorMock.defineTheme } }) => void;
    onMount?: (
      editor: {
        getModifiedEditor: () => { onMouseDown: (handler: NonNullable<typeof diffEditorMock.mouseDown>) => void };
      },
      monaco: { editor: { setTheme: typeof diffEditorMock.setTheme } },
    ) => void;
  }) => {
    if (!diffEditorMock.mounted) {
      diffEditorMock.mounted = true;
      props.beforeMount?.({ editor: { defineTheme: diffEditorMock.defineTheme } });
      props.onMount?.(
        {
          getModifiedEditor: () => ({
            onMouseDown: (handler) => {
              diffEditorMock.mouseDown = handler;
            },
          }),
        },
        { editor: { setTheme: diffEditorMock.setTheme } },
      );
    }
    return <div data-testid="diff-editor-mock" />;
  },
}));

import { DiffViewer } from "../features/diff-viewer/DiffViewer";

function fireGlyphMargin(lineNumber: number) {
  expect(diffEditorMock.mouseDown).not.toBeNull();
  act(() => {
    diffEditorMock.mouseDown?.({ target: { type: 2, position: { lineNumber } } });
  });
}

describe("DiffViewer glyph margin callback", () => {
  beforeEach(() => {
    diffEditorMock.mounted = false;
    diffEditorMock.mouseDown = null;
    diffEditorMock.defineTheme.mockClear();
    diffEditorMock.setTheme.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the latest onGlyphMarginClick after the prop changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<DiffViewer original="old" modified="new" onGlyphMarginClick={first} />);

    rerender(<DiffViewer original="old" modified="new" onGlyphMarginClick={second} />);
    fireGlyphMargin(42);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(42);
  });

  it("handles an initially absent callback becoming available later", () => {
    const handler = vi.fn();
    const { rerender } = render(<DiffViewer original="old" modified="new" />);

    rerender(<DiffViewer original="old" modified="new" onGlyphMarginClick={handler} />);
    fireGlyphMargin(7);

    expect(handler).toHaveBeenCalledWith(7);
  });
});
