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
  folder: "#c8a050",
  ts: "#3178c6",
  js: "#f0db4f",
  json: "#a6e3a1",
  md: "#89b4fa",
  rs: "#dea584",
  toml: "#9399b2",
  css: "#89dceb",
  html: "#fab387",
  yaml: "#f38ba8",
  py: "#f9e2af",
  svg: "#f5c2e7",
  image: "#94e2d5",
  shell: "#a6e3a1",
  git: "#f38ba8",
  lock: "#585b70",
  file: "rgba(255,255,255,0.3)",
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
