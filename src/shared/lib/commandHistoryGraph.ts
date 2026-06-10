import type { CommandHistoryRecord } from "../types/history";
import type { GitChangedFile } from "./reviewQueue";
import type { WorkstationGraphCommandBlock } from "./workstationGraph";

const MAX_COMMAND_FILE_LINKS = 12;

export interface NativeCommandBlockRecord {
  id: string;
  terminalId: string;
  commandHistoryId: number;
  command: string;
  cwd: string;
  status: string;
  exitCode: number | null;
  commandSequence: number | null;
  outputSequence: number | null;
  endSequence: number | null;
  commandHistorySize: number | null;
  outputHistorySize: number | null;
  endHistorySize: number | null;
  commandScreenLine: number | null;
  outputScreenLine: number | null;
  endScreenLine: number | null;
}

export function commandHistoryRecordsToCommandBlocks(
  records: readonly CommandHistoryRecord[],
  changedFiles: readonly GitChangedFile[],
  workspacePath: string,
): WorkstationGraphCommandBlock[] {
  const workspace = normalizePath(workspacePath).toLowerCase();
  const changedPaths = changedFiles.map((file) => normalizePath(file.path)).filter(Boolean);

  return records
    .filter((record) => isRecordInWorkspace(record, workspace))
    .map((record) => {
      const validationKind = inferCommandValidationKind(record.command);
      const filePaths = inferCommandFilePaths(record.command, changedPaths, validationKind !== "unknown");
      return {
        id: `history-${record.id}`,
        command: record.command,
        cwd: normalizePath(record.cwd),
        exitCode: record.exit_code,
        status: commandStatus(record.exit_code),
        terminalId: record.terminal_id,
        endedAt: record.executed_at,
        filePaths,
        validationKind,
      };
    })
    .filter((command) => command.validationKind !== "unknown" || (command.filePaths?.length ?? 0) > 0);
}

export function nativeCommandBlockRecordsToCommandBlocks(
  records: readonly NativeCommandBlockRecord[],
  changedFiles: readonly GitChangedFile[],
  workspacePath: string,
): WorkstationGraphCommandBlock[] {
  const workspace = normalizePath(workspacePath).toLowerCase();
  const changedPaths = changedFiles.map((file) => normalizePath(file.path)).filter(Boolean);

  return records
    .filter((record) => isNativeRecordInWorkspace(record, workspace))
    .map((record) => {
      const validationKind = inferCommandValidationKind(record.command);
      const filePaths = inferCommandFilePaths(record.command, changedPaths, validationKind !== "unknown");
      return {
        id: record.id,
        command: record.command,
        cwd: normalizePath(record.cwd),
        exitCode: record.exitCode,
        status: record.status,
        terminalId: record.terminalId,
        filePaths,
        validationKind,
        commandSequence: record.commandSequence,
        outputSequence: record.outputSequence,
        endSequence: record.endSequence,
        commandHistorySize: record.commandHistorySize,
        outputHistorySize: record.outputHistorySize,
        endHistorySize: record.endHistorySize,
        commandScreenLine: record.commandScreenLine,
        outputScreenLine: record.outputScreenLine,
        endScreenLine: record.endScreenLine,
      };
    })
    .filter((command) => command.validationKind !== "unknown" || (command.filePaths?.length ?? 0) > 0);
}

export function inferCommandValidationKind(command: string): string {
  const value = command.toLowerCase();
  if (/\b(vitest|jest|playwright|pytest|cargo test|cargo nextest|go test|pnpm test|npm test|yarn test)\b/.test(value)) {
    return "test";
  }
  if (/\b(biome check|eslint|clippy|cargo clippy|npm run lint|pnpm lint|yarn lint)\b/.test(value)) return "lint";
  if (/\b(tsc|typecheck|type-check|cargo check)\b/.test(value)) return "typecheck";
  if (/\b(pnpm build|npm run build|yarn build|cargo build|tauri build)\b/.test(value)) return "build";
  if (/\b(biome format|prettier|cargo fmt|rustfmt)\b/.test(value)) return "format";
  if (/\b(smoke|verify|qa|playwright screenshot)\b/.test(value)) return "smoke";
  return "unknown";
}

function inferCommandFilePaths(
  command: string,
  changedPaths: readonly string[],
  attachAllForValidation: boolean,
): string[] {
  if (changedPaths.length === 0) return [];
  if (attachAllForValidation) return changedPaths.slice(0, MAX_COMMAND_FILE_LINKS);

  const normalizedCommand = normalizePath(command).toLowerCase();
  return changedPaths
    .filter((path) => {
      const normalizedPath = path.toLowerCase();
      const basename = normalizedPath.split("/").pop() ?? normalizedPath;
      return (
        normalizedCommand.includes(normalizedPath) || (basename.length > 2 && normalizedCommand.includes(basename))
      );
    })
    .slice(0, MAX_COMMAND_FILE_LINKS);
}

function isRecordInWorkspace(record: CommandHistoryRecord, workspace: string): boolean {
  if (!workspace) return true;
  const cwd = normalizePath(record.cwd).toLowerCase();
  return cwd === workspace || cwd.startsWith(`${workspace}/`);
}

function isNativeRecordInWorkspace(record: NativeCommandBlockRecord, workspace: string): boolean {
  if (!workspace) return true;
  const cwd = normalizePath(record.cwd).toLowerCase();
  return cwd === workspace || cwd.startsWith(`${workspace}/`);
}

function commandStatus(exitCode: number | null): WorkstationGraphCommandBlock["status"] {
  if (exitCode == null) return "unknown";
  return exitCode === 0 ? "passed" : "failed";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}
