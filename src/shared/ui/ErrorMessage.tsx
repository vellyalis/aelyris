import { AlertCircle } from "lucide-react";
import { memo } from "react";

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorMessage = memo(function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-8)",
        color: "var(--ctp-red)",
        fontSize: "var(--text-md)",
      }}
    >
      <AlertCircle size={20} aria-hidden="true" />
      <span style={{ textAlign: "center", maxWidth: 300 }}>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: "none",
            border: "1px solid var(--ctp-red)",
            color: "var(--ctp-red)",
            padding: "var(--space-2) var(--space-6)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-sm)",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
});
