import { memo } from "react";

interface KeyboardShortcutProps {
  keys: string[];
}

export const KeyboardShortcut = memo(function KeyboardShortcut({ keys }: KeyboardShortcutProps) {
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {keys.map((key, i) => (
        <span key={i}>
          <kbd
            style={{
              display: "inline-block",
              padding: "1px var(--space-2)",
              fontSize: "var(--text-xs)",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              color: "var(--text-muted)",
              background: "var(--white-6)",
              border: "1px solid var(--white-10)",
              borderRadius: 3,
              lineHeight: 1.4,
            }}
          >
            {key}
          </kbd>
          {i < keys.length - 1 && (
            <span style={{ fontSize: 8, color: "var(--text-muted)", margin: "0 1px" }}>+</span>
          )}
        </span>
      ))}
    </span>
  );
});
