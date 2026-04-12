/**
 * Command block detection for terminal output.
 * Detects prompt patterns (PS1, $, #, >) to split terminal output
 * into individual command blocks, similar to Warp's block UI.
 */

export interface CommandBlock {
  /** Line number where the command starts (prompt line) */
  startLine: number;
  /** Line number where the command output ends (before next prompt) */
  endLine: number;
  /** The command text (after the prompt) */
  command: string;
  /** The prompt string itself */
  prompt: string;
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
 * Track command blocks from terminal buffer.
 * Call addLine() as new lines appear; getBlocks() returns detected blocks.
 */
export class CommandBlockTracker {
  private blocks: CommandBlock[] = [];
  private currentStart: number | null = null;
  private currentPrompt = "";
  private currentCommand = "";
  private lineCount = 0;

  addLine(line: string): void {
    const detected = detectPrompt(line);
    if (detected) {
      // Close previous block
      if (this.currentStart !== null) {
        this.blocks.push({
          startLine: this.currentStart,
          endLine: this.lineCount - 1,
          command: this.currentCommand,
          prompt: this.currentPrompt,
        });
      }
      // Start new block
      this.currentStart = this.lineCount;
      this.currentPrompt = detected.prompt;
      this.currentCommand = detected.command;
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

  /** Get the currently active (in-progress) block if any. */
  getCurrentBlock(): CommandBlock | null {
    if (this.currentStart === null) return null;
    return {
      startLine: this.currentStart,
      endLine: this.lineCount - 1,
      command: this.currentCommand,
      prompt: this.currentPrompt,
    };
  }

  /** Total number of completed blocks. */
  get blockCount(): number {
    return this.blocks.length;
  }
}
