import { memo } from "react";

interface KeyboardShortcutProps {
  keys: string[];
}

export const KeyboardShortcut = memo(function KeyboardShortcut({ keys }: KeyboardShortcutProps) {
  return (
    <span style={{ display: "inline-flex", gap: "var(--space-1)", alignItems: "center" }}>
      {keys.map((key, i) => {
        const prefix = keys.slice(0, i + 1).join("+");
        return (
          <span key={prefix}>
            <kbd
              style={{
                display: "inline-block",
                padding: "var(--space-1) var(--space-2)",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-ui)",
                fontWeight: "var(--weight-medium)",
                color: "var(--text-muted)",
                background: "var(--white-6)",
                border: "1px solid var(--white-10)",
                borderRadius: "var(--radius-sm)",
                lineHeight: "var(--leading-tight)",
              }}
            >
              {key}
            </kbd>
            {i < keys.length - 1 && (
              <span
                aria-hidden="true"
                style={{ fontSize: "var(--text-2xs)", color: "var(--text-muted)", margin: "0 var(--space-1)" }}
              >
                +
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
});
