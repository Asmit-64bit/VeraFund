import { Component, type ErrorInfo, type ReactNode } from "react";

interface RouteErrorBoundaryProps {
  children: ReactNode;
  routeKey: string;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

export default class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route render failed:", error, info);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps) {
    if (prevProps.routeKey !== this.props.routeKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-container">
          <div className="empty-state">
            <div className="empty-state-title">Something broke on this page</div>
            <div className="empty-state-subtitle">
              Refresh once. If it still happens, the route hit a runtime error and needs attention.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
