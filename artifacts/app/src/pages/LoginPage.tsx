import { useState } from "react";
import { Wifi, LogIn, ShieldCheck, Store, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useAppNavigate } from "@/hooks/use-app-navigate";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LoginPageProps {
  mode: "admin" | "vendor" | "choose";
}

export default function LoginPage({ mode }: LoginPageProps) {
  const { login } = useAuth();
  const navigate = useAppNavigate();
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = mode === "admin";

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
                <p className="text-xs text-blue-400 mt-0.5">Admin / Gérant de zone</p>
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
      const res = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: form.login.trim(), password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Identifiants incorrects");
        return;
      }

      if (isAdmin && data.role === "vendor") {
        setError("Ce compte est un compte vendeur. Veuillez utiliser l'espace Vendeurs/Revendeurs.");
        return;
      }
      if (!isAdmin && (data.role === "admin" || data.role === "manager")) {
        setError("Ce compte est un compte administrateur. Veuillez utiliser l'espace Administrateurs/Gérant de zone.");
        return;
      }

      login(data.token, data.role, data.vendor ?? undefined, data.manager?.routerId ?? null);
      if (data.role === "vendor") {
        navigate("/vendor-portal");
      } else if (data.role === "manager") {
        navigate("/");
      } else {
        navigate("/routers");
      }
    } catch {
      setError("Impossible de contacter le serveur");
    } finally {
      setLoading(false);
    }
  };

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
          <p className={`text-xs font-medium mb-5 ${isAdmin ? "text-blue-400" : "text-emerald-400"}`}>
            {isAdmin ? "Espace Administrateurs / Gérant de zone" : "Espace Vendeurs / Revendeurs"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-gray-300 text-sm">Identifiant</Label>
              <Input
                className="mt-1 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                placeholder={isAdmin ? "admin ou gérant" : "nom du vendeur"}
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
