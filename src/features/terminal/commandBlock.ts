/**
 * Command block detection and tracking for terminal output.
 *
 * A "block" is a single shell invocation — a prompt line, the command the
 * user typed, and every output line the shell emitted before the next
 * prompt appeared.  Blocks are what the Warp-style "block output UI"
 * groups by: copy, rerun, expand/collapse, navigation all operate on a
 * block.
 */

export interface CommandBlock {
  /** Stable id — monotonic per tracker instance. */
  id: string;
  /** Line index of the prompt line in the tracker's virtual line stream. */
  startLine: number;
  /** Line index of the last output line (inclusive). */
  endLine: number;
  /** The command the user typed (text after the prompt). */
  command: string;
  /** The prompt string itself (e.g. "PS C:\\path> "). */
  prompt: string;
  /** Captured output lines (excluding the prompt/command line itself). */
  outputLines: string[];
  /** Wall-clock ms when the prompt was first seen. */
  startedAt: number;
  /**
   * Wall-clock ms when the NEXT prompt appeared (i.e. this block finished),
   * or null while the block is still the active one.
   */
  endedAt: number | null;
}

// Common shell prompt patterns
const PROMPT_PATTERNS = [
  // PowerShell: PS C:\path>
  /^PS [A-Z]:\\[^>]*>\s*/,
  // Bash/Zsh with $: user@host:~/path$
  /^[^\s]*[#$]\s+/,
  // Simple $
  /^\$\s+/,
  // Simple >
  /^>\s+/,
  // Fish: user@host ~/path>
  /^[^\s]+@[^\s]+ [^>]+>\s*/,
  // CMD: C:\path>
  /^[A-Z]:\\[^>]*>\s*/,
  // Lambda/chevron prompts
  /^[❯λ➜→]\s+/,
];

/**
 * Detect if a line is a shell prompt line.
 * Returns the prompt string if detected, null otherwise.
 */
export function detectPrompt(line: string): { prompt: string; command: string } | null {
  const trimmed = line.trimStart();
  for (const pattern of PROMPT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        prompt: match[0],
        command: trimmed.slice(match[0].length).trim(),
      };
    }
  }
  return null;
}

/**
 * Track command blocks from terminal output.
 *
 * Call `addLine()` for each line that arrives from the PTY (after ANSI
 * stripping, ideally).  Completed blocks accumulate in `getBlocks()`; the
 * currently-building block is available via `getCurrentBlock()`.
 *
 * The tracker never prunes — a long session produces an unbounded block
 * list.  Call `prune(maxBlocks)` from the caller if that matters.
 */
export class CommandBlockTracker {
  private blocks: CommandBlock[] = [];
  private currentStart: number | null = null;
  private currentPrompt = "";
  private currentCommand = "";
  private currentOutput: string[] = [];
  private currentStartedAt = 0;
  private lineCount = 0;
  private nextId = 0;

  addLine(line: string): void {
    const detected = detectPrompt(line);
    if (detected) {
      // Close previous block
      if (this.currentStart !== null) {
        this.blocks.push({
          id: `blk-${this.nextId++}`,
          startLine: this.currentStart,
          endLine: this.lineCount - 1,
          command: this.currentCommand,
          prompt: this.currentPrompt,
          outputLines: this.currentOutput,
          startedAt: this.currentStartedAt,
          endedAt: Date.now(),
        });
      }
      // Start new block
      this.currentStart = this.lineCount;
      this.currentPrompt = detected.prompt;
      this.currentCommand = detected.command;
      this.currentOutput = [];
      this.currentStartedAt = Date.now();
    } else if (this.currentStart !== null) {
      // Non-prompt line while a block is open: capture as output.
      this.currentOutput.push(line);
    }
    this.lineCount++;
  }

  /** Get all completed blocks (not the currently active one). */
  getBlocks(): readonly CommandBlock[] {
    return this.blocks;
  }

  /** Get the most recent N blocks. */
  getRecentBlocks(n: number): CommandBlock[] {
    return this.blocks.slice(-n);
  }

  /**
   * Get the currently active (in-progress) block if any.  The returned
   * object is a snapshot — it will not update as more output arrives.
   */
  getCurrentBlock(): CommandBlock | null {
    if (this.currentStart === null) return null;
    return {
      id: "blk-current",
      startLine: this.currentStart,
      endLine: this.lineCount - 1,
      command: this.currentCommand,
      prompt: this.currentPrompt,
      outputLines: this.currentOutput.slice(),
      startedAt: this.currentStartedAt,
      endedAt: null,
    };
  }

  /** Total number of completed blocks. */
  get blockCount(): number {
    return this.blocks.length;
  }

  /** Drop the oldest blocks so at most `maxBlocks` remain. */
  prune(maxBlocks: number): void {
    if (this.blocks.length > maxBlocks) {
      this.blocks = this.blocks.slice(-maxBlocks);
    }
  }
}
