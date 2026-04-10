import { memo } from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode2,
  FileJson2,
  FileType,
  FileCog,
  FileImage,
  FileTerminal,
  GitBranch,
  Lock,
  File,
} from "lucide-react";

const SIZE = 14;

const COLORS: Record<string, string> = {
  folder: "var(--gold)",
  ts: "var(--ctp-blue)",
  js: "var(--ctp-yellow)",
  json: "var(--ctp-green)",
  md: "var(--ctp-blue)",
  rs: "var(--ctp-peach)",
  toml: "var(--ctp-mauve)",
  css: "var(--ctp-cyan)",
  html: "var(--ctp-peach)",
  yaml: "var(--ctp-red)",
  py: "var(--ctp-yellow)",
  svg: "var(--ctp-magenta)",
  image: "var(--ctp-cyan)",
  shell: "var(--ctp-green)",
  git: "var(--ctp-red)",
  lock: "var(--text-muted)",
  file: "var(--text-muted)",
};

const ICON_MAP: Record<string, typeof File> = {
  ts: FileCode2,
  js: FileCode2,
  rs: FileCog,
  py: FileCode2,
  html: FileCode2,
  css: FileType,
  json: FileJson2,
  md: FileText,
  toml: FileCog,
  yaml: FileCog,
  svg: FileImage,
  image: FileImage,
  shell: FileTerminal,
  git: GitBranch,
  lock: Lock,
};

export const FileIcon = memo(function FileIcon({ type, isOpen }: { type: string; isOpen?: boolean }) {
  const color = COLORS[type] ?? COLORS.file;

  if (type === "folder") {
    const Icon = isOpen ? FolderOpen : Folder;
    return <Icon size={SIZE} color={color} strokeWidth={1.5} />;
  }

  const Icon = ICON_MAP[type] ?? File;
  return <Icon size={SIZE} color={color} strokeWidth={1.5} />;
});
