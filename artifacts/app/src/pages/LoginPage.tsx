import { useState } from "react";
import { Wifi, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LoginPage() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <Wifi className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">VoucherNet</h1>
          <p className="text-sm text-gray-400 mt-1">Gestion Hotspot MikroTik</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-800">
          <h2 className="text-lg font-semibold text-white mb-5">Connexion</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-gray-300 text-sm">Identifiant</Label>
              <Input
                className="mt-1 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                placeholder="admin ou nom du vendeur"
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
              className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
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
