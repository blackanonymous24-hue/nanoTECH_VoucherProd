import { Component, ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function isChunkError(err: Error): boolean {
  const msg = err.message ?? "";
  const name = err.name ?? "";
  return (
    name === "ChunkLoadError" ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("Unable to preload CSS for") ||
    msg.includes("dynamically imported module")
  );
}

const RELOAD_KEY = "peb:last-reload";

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isChunkError(error)) {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (Date.now() - last > 15_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (isChunkError(error)) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-gray-400">
          <RefreshCw className="h-7 w-7 animate-spin" />
          <p className="text-sm font-medium">Rechargement de la page…</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5 p-8 text-center">
        <div className="h-14 w-14 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center">
          <RefreshCw className="h-6 w-6 text-red-400" />
        </div>
        <div>
          <p className="text-gray-800 font-semibold text-base">
            Une erreur inattendue est survenue
          </p>
          <p className="text-gray-400 text-sm mt-1">
            {error.message?.slice(0, 120) || "Erreur inconnue"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={this.retry} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Réessayer
        </Button>
        <button
          className="text-xs text-gray-400 underline underline-offset-2"
          onClick={() => window.location.reload()}
        >
          Recharger la page complète
        </button>
      </div>
    );
  }
}
