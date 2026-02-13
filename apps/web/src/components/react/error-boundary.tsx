import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div class="p-6 rounded-lg bg-red-500/10 border border-red-500/20">
            <p class="text-red-400 text-sm">
              Something went wrong loading this component.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              class="mt-2 text-xs text-zinc-400 hover:text-zinc-300 underline"
            >
              Try again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
