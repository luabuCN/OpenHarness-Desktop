import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Root render guard. React unmounts the entire tree on an uncaught render
 * error, which shows up as a blank window; this keeps a readable error card
 * with a reload action instead. */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面渲染出错:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground"
      >
        <h1 className="text-base font-semibold">界面渲染出错</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          页面组件发生异常，可通过刷新恢复。若反复出现，请将下方错误信息反馈给开发者。
        </p>
        <pre className="max-h-48 w-full max-w-2xl overflow-auto rounded-md border bg-muted/50 p-3 text-left font-mono text-xs text-muted-foreground">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          刷新页面
        </button>
      </div>
    );
  }
}
