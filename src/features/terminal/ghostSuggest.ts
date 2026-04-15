/**
 * Ghost suggestion engine for terminal command prediction.
 * Analyzes command history and current input to suggest completions.
 *
 * Renders a semi-transparent "ghost" text after the cursor,
 * similar to GitHub Copilot's inline suggestions.
 */

/**
 * Find the best matching suggestion from command history.
 * Returns the full command if a prefix match is found, null otherwise.
 */
export function findSuggestion(
  currentInput: string,
  history: readonly string[],
): string | null {
  if (currentInput.length < 2) return null;

  const lower = currentInput.toLowerCase();

  // Search from most recent to oldest
  for (let i = history.length - 1; i >= 0; i--) {
    const cmd = history[i];
    if (cmd.toLowerCase().startsWith(lower) && cmd.length > currentInput.length) {
      return cmd;
    }
  }

  return null;
}

/**
 * Manages the ghost suggestion overlay on a terminal container.
 * Creates a DOM element that shows predicted text in a dimmed style.
 */
export class GhostSuggestOverlay {
  private overlay: HTMLDivElement;
  private currentSuggestion: string | null = null;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement("div");
    this.overlay.style.cssText = `
      position: absolute;
      display: none;
      pointer-events: none;
      z-index: 10;
      color: rgba(166, 173, 200, 0.35);
      font-family: "IBM Plex Mono", "Cascadia Code", monospace;
      font-size: 14px;
      line-height: 1.4;
      white-space: pre;
    `;
    container.style.position = "relative";
    container.appendChild(this.overlay);
  }

  /** Show a ghost suggestion at the cursor position. */
  show(suggestion: string, inputLength: number, cursorX: number, cursorY: number): void {
    this.currentSuggestion = suggestion;
    // Only show the part after what's already typed
    const ghost = suggestion.slice(inputLength);
    if (!ghost) {
      this.hide();
      return;
    }

    this.overlay.textContent = ghost;
    this.overlay.style.display = "block";
    this.overlay.style.left = `${cursorX}px`;
    this.overlay.style.top = `${cursorY}px`;
  }

  /** Hide the ghost suggestion. */
  hide(): void {
    this.overlay.style.display = "none";
    this.overlay.textContent = "";
    this.currentSuggestion = null;
  }

  /** Get the current suggestion (for Tab completion). */
  getSuggestion(): string | null {
    return this.currentSuggestion;
  }

  /** Clean up the overlay element. */
  dispose(): void {
    this.overlay.remove();
  }
}
