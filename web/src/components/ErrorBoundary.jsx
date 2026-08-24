import * as React from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Catches render errors so one broken page cannot blank the whole app.
 *
 * React unmounts the entire tree when a render throws, which is how a single
 * bad value in the turn-by-turn list turned the Safe route page completely
 * white with nothing to act on. This keeps the shell alive and offers a way
 * back — and in dev it shows the actual error instead of hiding it.
 *
 * Must be a class: there is no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep it in the console for the dev overlay / bug reports.
    console.error("[ProTego] render error:", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // A route change should clear a stale error, otherwise navigating away
    // from the broken page keeps showing this screen.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-destructive/15 text-destructive">
          <AlertTriangle className="size-6" />
        </span>

        <h1 className="mt-4 text-xl font-semibold tracking-tight">This page hit a problem</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Something in this screen failed to render. The rest of the app is fine —
          reloading usually clears it.
        </p>

        {import.meta.env.DEV ? (
          <pre className="mt-4 max-w-lg overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
            {String(error?.message ?? error)}
          </pre>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCcw className="size-4" />
            Reload
          </Button>
          <Button variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button asChild variant="ghost">
            <a href="/">
              <Home className="size-4" />
              Dashboard
            </a>
          </Button>
        </div>
      </div>
    );
  }
}
