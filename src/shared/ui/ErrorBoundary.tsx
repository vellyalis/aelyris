import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Intentionally silent — error is rendered in fallback UI
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            role="alert"
            style={{
              padding: "var(--space-12)",
              color: "var(--ctp-red)",
              background: "var(--glass-solid)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-md)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" }}>Something went wrong</div>
            <pre style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                background: "none",
                border: "1px solid var(--ctp-red)",
                color: "var(--ctp-red)",
                padding: "var(--space-2) var(--space-6)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                alignSelf: "flex-start",
              }}
            >
              Retry
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
