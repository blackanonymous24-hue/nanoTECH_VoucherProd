import { useState, useEffect } from "react";
import { Wifi, LogIn, ShieldCheck, Store, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useAppNavigate } from "@/hooks/use-app-navigate";
import { clearApiRequestPause, fetchWithoutInterceptors } from "@/lib/installAuthFetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const LOGIN_RETRIES = 3;
const LOGIN_RETRY_MS = [0, 350, 800];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchLogin(body: { login: string; password: string }): Promise<Response> {
  const url = `${BASE}/api/login`;
  let lastErr: unknown;
  for (let i = 0; i < LOGIN_RETRIES; i++) {
    if (LOGIN_RETRY_MS[i] > 0) await sleep(LOGIN_RETRY_MS[i]);
    try {
      // Ne pas utiliser window.fetch patché : pause « génération », Authorization ou abort global
      // peuvent faire échouer la connexion alors que le serveur répond.
      return await fetchWithoutInterceptors(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function parseLoginResponse(
  text: string,
  res: Response,
): { data: Record<string, unknown>; bodyOk: boolean } {
  if (!text.trim()) {
    if (!res.ok) {
      return {
        bodyOk: true,
        data: { error: res.status >= 500 ? `Serveur indisponible (${res.status})` : `Erreur ${res.status}` },
      };
    }
    return { bodyOk: true, data: {} };
  }
  try {
    return { bodyOk: true, data: JSON.parse(text) as Record<string, unknown> };
  } catch {
    const hint = res.status >= 500
      ? `Le serveur ne répond pas correctement (${res.status}). Réessayez dans un instant.`
      : "Réponse du serveur illisible. Vérifiez la connexion ou contactez l’administrateur.";
    return { bodyOk: false, data: { error: hint } };
  }
}

interface LoginPageProps {
  mode: "admin" | "vendor" | "choose";
}

export default function LoginPage({ mode }: LoginPageProps) {
  const { login } = useAuth();
  const navigate = useAppNavigate();
  const [form, setForm] = useState({ login: "", password: "" });
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = mode === "admin";

  useEffect(() => {
    if (mode !== "choose") clearApiRequestPause();
  }, [mode]);

  /* ── Écran de choix du rôle ───────────────────────────────── */
  if (mode === "choose") {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">

          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg bg-blue-600">
              <Wifi className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">nanoTECH Vouchers Bills</h1>
            <p className="text-sm text-gray-400 mt-1">Gestion Hotspot MikroTik</p>
          </div>

          <div className="bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-800 space-y-3">
            <p className="text-xs font-medium text-gray-400 text-center mb-4 uppercase tracking-wider">
              Sélectionnez votre espace
            </p>

            <button
              onClick={() => navigate("/admin")}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-blue-600/10 border border-blue-600/30 hover:bg-blue-600/20 hover:border-blue-500 transition-all group text-left"
            >
              <div className="h-11 w-11 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Je suis administrateur</p>
                <p className="text-xs text-blue-400 mt-0.5">Admin / Gérant de zone / Collaborateur</p>
              </div>
            </button>

            <button
              onClick={() => navigate("/vendeur")}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-emerald-600/10 border border-emerald-600/30 hover:bg-emerald-600/20 hover:border-emerald-500 transition-all group text-left"
            >
              <div className="h-11 w-11 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                <Store className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Je suis vendeur</p>
                <p className="text-xs text-emerald-400 mt-0.5">Vendeur / Revendeur</p>
              </div>
            </button>
          </div>

        </div>
      </div>
    );
  }

  /* ── Formulaire de connexion ──────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetchLogin({ login: form.login.trim(), password: form.password });
      const text = await res.text();
      const { data, bodyOk } = parseLoginResponse(text, res);
      if (!bodyOk) {
        setError(String(data.error ?? "Réponse invalide"));
        return;
      }
      if (!res.ok) {
        setError(String(data.error ?? "Identifiants incorrects"));
        return;
      }

      const role = data.role as string | undefined;
      const token = data.token as string | undefined;
      if (!token || !role) {
        setError("Réponse de connexion incomplète. Réessayez.");
        return;
      }

      if (isAdmin && role === "vendor") {
        setError("Ce compte est un compte vendeur. Veuillez utiliser l'espace Vendeurs/Revendeurs.");
        return;
      }
      if (!isAdmin && (role === "admin" || role === "manager" || role === "collaborateur")) {
        setError("Ce compte est un compte administrateur. Veuillez utiliser l'espace Administrateurs/Gérant de zone.");
        return;
      }

      const vendor = data.vendor as Parameters<typeof login>[2] | undefined;
      const manager = data.manager as { routerId?: number | null } | undefined;
      const collaborateur = data.collaborateur as { routerIds?: number[] } | undefined;

      login(
        token,
        role as "admin" | "manager" | "vendor" | "collaborateur",
        vendor,
        manager?.routerId ?? null,
        collaborateur?.routerIds,
        remember,
        data.isSuperAdmin === true,
      );
      if (role === "vendor") {
        navigate("/vendor-portal");
      } else if (role === "manager" || role === "collaborateur") {
        navigate("/");
      } else {
        navigate("/routers");
      }
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
      if (msg === "api-paused") {
        setError("Connexion temporairement bloquée. Rechargez la page puis réessayez.");
        return;
      }
      setError("Impossible de contacter le serveur. Vérifiez le réseau et que l’API tourne, puis réessayez.");
    } finally {
      setLoading(false);
    }
  };

  const accentClass  = isAdmin ? "text-blue-400"   : "text-emerald-400";
  const checkboxRing = isAdmin ? "accent-blue-500"  : "accent-emerald-500";

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg ${isAdmin ? "bg-blue-600" : "bg-emerald-600"}`}>
            <Wifi className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">nanoTECH Vouchers Bills</h1>
          <p className="text-sm text-gray-400 mt-1">Gestion Hotspot MikroTik</p>
        </div>

        {/* Form card */}
        <div className="bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-800">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-gray-500 hover:text-gray-300 transition-colors p-0.5 rounded"
              title="Retour au choix"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h2 className="text-base font-semibold text-white">Connexion</h2>
          </div>
          <p className={`text-xs font-medium mb-5 ${accentClass}`}>
            {isAdmin ? "Espace Administrateurs / Gérant de zone / Collaborateur" : "Espace Vendeurs / Revendeurs"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-gray-300 text-sm">Identifiant</Label>
              <Input
                className="mt-1 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                placeholder={isAdmin ? "admin, gérant ou collaborateur" : "nom du vendeur"}
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
                autoFocus
                autoComplete="username"
                required
              />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">Mot de passe</Label>
              <Input
                className="mt-1 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>

            {/* Se souvenir de moi */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className={`w-4 h-4 rounded border-gray-600 bg-gray-800 cursor-pointer ${checkboxRing}`}
              />
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                Se souvenir de moi
              </span>
            </label>

            {error && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className={`w-full text-white gap-2 ${isAdmin ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
              disabled={loading}
            >
              <LogIn className="h-4 w-4" />
              {loading ? "Connexion..." : "Se connecter"}
            </Button>
          </form>

          {/* Switch role link */}
          <p className="mt-4 text-center text-xs text-gray-500">
            {isAdmin ? "Vous êtes vendeur ?" : "Vous êtes administrateur ?"}{" "}
            <button
              type="button"
              onClick={() => navigate(isAdmin ? "/vendeur" : "/admin")}
              className={`font-medium underline underline-offset-2 ${isAdmin ? "text-emerald-400 hover:text-emerald-300" : "text-blue-400 hover:text-blue-300"} transition-colors`}
            >
              {isAdmin ? "Espace vendeurs" : "Espace admin"}
            </button>
          </p>
        </div>

      </div>
    </div>
  );
}
