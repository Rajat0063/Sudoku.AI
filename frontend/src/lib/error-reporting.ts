type ErrorReportOptions = {
  mechanism?:
    | "manual"
    | "onerror"
    | "unhandledrejection"
    | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type ErrorReporter = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: ErrorReportOptions,
  ) => void;
};

declare global {
  interface Window {
    __errorReporter?: ErrorReporter;
    // Back-compat: the host platform may still inject this global.
    __lovableEvents?: ErrorReporter;
  }
}

export function reportError(
  error: unknown,
  context: Record<string, unknown> = {},
) {
  if (typeof window === "undefined") return;
  const reporter = window.__errorReporter ?? window.__lovableEvents;
  reporter?.captureException?.(
    error,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );
}
