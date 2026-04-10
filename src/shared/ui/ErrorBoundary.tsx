import { Component, type ReactNode, type ErrorInfo } from "react";

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
      return this.props.fallback ?? (
        <div style={{
          padding: 24, color: "#f38ba8", background: "#0d0d0d",
          fontFamily: "IBM Plex Mono, monospace", fontSize: 12,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Something went wrong</div>
          <pre style={{ color: "#a6adc8", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: "none", border: "1px solid #f38ba8", color: "#f38ba8",
              padding: "4px 12px", borderRadius: 4, cursor: "pointer", alignSelf: "flex-start",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
