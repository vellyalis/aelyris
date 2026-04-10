import { memo } from "react";
import { AlertCircle } from "lucide-react";

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorMessage = memo(function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)",
      padding: "var(--space-8)", color: "var(--ctp-red)", fontSize: 12,
    }}>
      <AlertCircle size={20} />
      <span style={{ textAlign: "center", maxWidth: 300 }}>{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: "none", border: "1px solid var(--ctp-red)", color: "var(--ctp-red)",
            padding: "var(--space-2) var(--space-6)", borderRadius: "var(--radius-sm)",
            fontSize: 11, cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
});
