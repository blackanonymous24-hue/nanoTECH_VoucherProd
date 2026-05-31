import { Router, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type RouterOfflineOverlayProps = {
  secondsLeft: number;
  onGoNow: () => void;
  className?: string;
};

/** Page d'erreur après 3 pings TCP échoués — compte à rebours 10 s avant /routers. */
export function RouterOfflineOverlay({ secondsLeft, onGoNow, className }: RouterOfflineOverlayProps) {
  return (
    <div
      className={
        className
        ?? "fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm py-16 px-4"
      }
    >
      <div className="relative flex flex-col items-center mb-8">
        <div className="relative flex items-center justify-center mb-4">
          <div
            className="absolute h-28 w-28 rounded-full bg-red-100 opacity-30"
            style={{ animation: "ping 2s cubic-bezier(0,0,.2,1) infinite" }}
          />
          <div className="absolute h-20 w-20 rounded-full bg-red-100 opacity-50 animate-pulse" />
          <div className="relative h-16 w-16 rounded-full bg-red-50 border-2 border-red-200 shadow-sm flex items-center justify-center">
            <WifiOff className="h-8 w-8 text-red-400" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5 my-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-red-300 animate-bounce"
              style={{ animationDelay: `${i * 0.18}s`, animationDuration: "1.1s" }}
            />
          ))}
        </div>

        <div className="mt-1 h-12 w-12 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
          <Router className="h-6 w-6 text-gray-300" />
        </div>
      </div>

      <h2 className="text-xl font-bold text-gray-800 text-center leading-snug">
        Impossible de contacter le routeur
      </h2>
      <p className="text-base font-bold text-red-500 text-center mt-1">
        MikroTik éteint ou hors ligne&nbsp;!!!
      </p>
      <p className="text-sm text-gray-500 text-center mt-3 max-w-sm leading-relaxed">
        Le routeur sélectionné ne répond pas après 3 tentatives de connexion.
      </p>
      <p className="text-sm text-gray-600 text-center mt-4 font-medium">
        Redirection vers la liste des routeurs dans{" "}
        <span className="tabular-nums text-red-600">{secondsLeft}</span> s…
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-6 border-gray-200 text-gray-700 hover:bg-gray-50 gap-2"
        onClick={onGoNow}
      >
        Aller aux routeurs maintenant
      </Button>
    </div>
  );
}
