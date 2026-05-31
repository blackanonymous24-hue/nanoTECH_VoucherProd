import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext } from "@/contexts/RouterContext";

export const ROUTER_OFFLINE_REDIRECT_MS = 10_000;

/** Après 3 pings échoués : compte à rebours 10 s puis redirection /routers. */
export function useRouterOfflineRedirect() {
  const { isPingFailed, setIsPingFailed, selectedRouterId } = useRouterContext();
  const [location, navigate] = useLocation();
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(ROUTER_OFFLINE_REDIRECT_MS / 1000),
  );

  useEffect(() => {
    if (!isPingFailed || !selectedRouterId) return;
    if (location.startsWith("/routers")) {
      setIsPingFailed(false);
      return;
    }

    setSecondsLeft(Math.ceil(ROUTER_OFFLINE_REDIRECT_MS / 1000));
    const tick = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    const t = window.setTimeout(() => {
      setIsPingFailed(false);
      toast.error("Hors ligne", {
        id: "router-ping-redirect",
        description:
          "Le routeur sélectionné ne répond pas. Vérifiez l'alimentation ou la connexion du MikroTik.",
        duration: 8000,
      });
      navigate("/routers");
    }, ROUTER_OFFLINE_REDIRECT_MS);

    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
  }, [isPingFailed, selectedRouterId, setIsPingFailed, navigate, location]);

  const goNow = () => {
    setIsPingFailed(false);
    toast.error("Hors ligne", {
      id: "router-ping-redirect",
      description:
        "Le routeur sélectionné ne répond pas. Vérifiez l'alimentation ou la connexion du MikroTik.",
      duration: 8000,
    });
    navigate("/routers");
  };

  const showOverlay =
    isPingFailed &&
    !!selectedRouterId &&
    !location.startsWith("/routers");

  return { showOverlay, secondsLeft, goNow };
}
