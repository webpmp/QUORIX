import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  compact?: boolean;
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  declare props: Readonly<ErrorBoundaryProps>;
  declare setState: (
    state:
      | Partial<ErrorBoundaryState>
      | ((prevState: Readonly<ErrorBoundaryState>) => Partial<ErrorBoundaryState> | null)
  ) => void;
  state: ErrorBoundaryState;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Quorix UI boundary caught runtime error:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      const title = this.props.fallbackTitle || 'TERMINAL RENDER ERROR';
      const message = this.state.error.message || 'An unexpected rendering error occurred.';

      if (this.props.compact) {
        return (
          <div className="bg-[#050505] border border-[#ff4444]/60 rounded p-4 font-mono text-xs text-zinc-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#ff4444] font-bold uppercase tracking-wider">{title}</span>
              <button
                type="button"
                onClick={this.handleReset}
                className="px-2.5 py-1 rounded border border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900] hover:text-black text-xs font-bold cursor-pointer"
              >
                RETRY
              </button>
            </div>
            <p className="text-zinc-400 break-words">{message}</p>
          </div>
        );
      }

      return (
        <div className="min-h-screen w-screen bg-[#010101] text-zinc-200 font-mono flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#050505] border border-[#ff4444]/60 rounded p-5 space-y-3">
            <div className="text-[#ff4444] text-sm font-extrabold uppercase tracking-wider">
              {title}
            </div>
            <p className="text-xs text-zinc-300 break-words">{message}</p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-3 py-1.5 rounded bg-[#ff9900] text-black text-xs font-extrabold cursor-pointer"
              >
                RETRY RENDER
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 rounded border border-[#333] text-zinc-300 hover:text-white text-xs font-bold cursor-pointer"
              >
                RELOAD APP
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
