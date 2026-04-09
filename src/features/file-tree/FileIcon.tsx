import { memo } from "react";

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

export const FileIcon = memo(function FileIcon({ type, isOpen }: { type: string; isOpen?: boolean }) {
  const color = COLORS[type] ?? COLORS.file;

  if (type === "folder") {
    return isOpen ? (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M1.5 3.5h5l1.5 1.5H14.5v8h-13v-9.5z" stroke={color} strokeWidth="1.2" fill="none"/>
        <path d="M1.5 7h13" stroke={color} strokeWidth="0.8" opacity="0.4"/>
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M1.5 3.5h5l1.5 1.5H14.5v8h-13v-9.5z" stroke={color} strokeWidth="1.2" fill="none"/>
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4 1.5h5.5L13 5v9.5H4V1.5z" stroke={color} strokeWidth="1" fill="none"/>
      <path d="M9.5 1.5V5H13" stroke={color} strokeWidth="0.8" opacity="0.5"/>
    </svg>
  );
});
