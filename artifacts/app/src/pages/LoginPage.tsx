import { useState } from "react";
import { Wifi, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LoginPageProps {
  mode: "admin" | "vendor";
}

export default function LoginPage({ mode }: LoginPageProps) {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = mode === "admin";

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

      login(data.token, data.role, data.vendor ?? undefined);
      if (data.role === "vendor") {
        navigate("/vendor-portal");
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
          <h1 className="text-2xl font-bold text-white">VoucherNet</h1>
          <p className="text-sm text-gray-400 mt-1">Gestion Hotspot MikroTik</p>
        </div>

        {/* Form card */}
        <div className="bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-800">
          <h2 className="text-base font-semibold text-white mb-1">Connexion</h2>
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
        </div>

      </div>
    </div>
  );
}
