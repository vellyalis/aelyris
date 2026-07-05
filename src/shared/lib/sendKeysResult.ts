export interface SkippedTerminalWrite {
  terminalId: string;
  reason: string;
}

export interface TerminalWriteBatchResult {
  accepted: number;
  skipped: SkippedTerminalWrite[];
}

export type SendKeysBatchResult = number | TerminalWriteBatchResult;

export function acceptedTerminalWrites(result: SendKeysBatchResult): number {
  if (typeof result === "number") return result;
  return result.accepted;
}

export function skippedTerminalWrites(result: SendKeysBatchResult): SkippedTerminalWrite[] {
  if (typeof result === "number") return [];
  return result.skipped;
}
