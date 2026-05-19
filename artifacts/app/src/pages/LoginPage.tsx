import { useState, useEffect } from "react";
import { LogIn, ShieldCheck, Store, ArrowLeft, KeyRound } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth, type UserRole } from "@/contexts/AuthContext";
import { useAppNavigate } from "@/hooks/use-app-navigate";
import { AUTH_SECURITY_REQUIRED_PATH, AUTH_SIGN_IN_PATH } from "@/lib/auth-api-paths";
import { describeFetchFailure, fetchJsonWithTimeout } from "@/lib/api-fetch";

async function fetchSecurityRequired(login: string, password: string): Promise<boolean | null> {
  try {
    const { res, data } = await fetchJsonWithTimeout<{ required?: boolean }>(
      AUTH_SECURITY_REQUIRED_PATH,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password }),
        timeoutMs: 12_000,
      },
    );
    if (!res.ok) return false;
    return !!data.required;
  } catch {
    return null;
  }
}

interface LoginPageProps {
  mode: "admin" | "vendor" | "choose";
}

export default function LoginPage({ mode }: LoginPageProps) {
  const { login } = useAuth();
  const navigate = useAppNavigate();
  const [form, setForm] = useState({ login: "", password: "" });
  const [securityCode, setSecurityCode] = useState("");
  const [needsSecurityCode, setNeedsSecurityCode] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = mode === "admin";

  useEffect(() => {
    if (!isAdmin) {
      setNeedsSecurityCode(false);
      return;
    }
    const loginTrimmed = form.login.trim();
    if (!loginTrimmed || !form.password) {
      setNeedsSecurityCode(false);
      setSecurityCode("");
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchSecurityRequired(loginTrimmed, form.password).then((required) => {
        setNeedsSecurityCode(required);
        if (!required) setSecurityCode("");
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [form.login, form.password, isAdmin]);

  /* ── Écran de choix du rôle ───────────────────────────────── */
  if (mode === "choose") {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">

          <div className="text-center mb-10">
            <BrandLogo size="xl" className="mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white">nanoTECH Vouchers</h1>
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
    const loginTrimmed = form.login.trim();
    let securityRequired = needsSecurityCode;
    if (isAdmin && loginTrimmed && form.password) {
      const required = await fetchSecurityRequired(loginTrimmed, form.password);
      if (required !== null) {
        securityRequired = required;
        setNeedsSecurityCode(required);
      }
    }
    if (isAdmin && securityRequired && !securityCode.trim()) {
      setError("Code de sécurité requis pour ce compte (super-admin originel).");
      return;
    }
    setLoading(true);

    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 1200;

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const { res, data } = await fetchJsonWithTimeout<Record<string, unknown>>(AUTH_SIGN_IN_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              login: loginTrimmed,
              password: form.password,
              ...(isAdmin && securityRequired
                ? { verificationCode: securityCode.trim() }
                : {}),
            }),
          });
          if (!res.ok) {
            const errMsg = (typeof data.error === "string" && data.error) || "Identifiants incorrects";
            if (
              isAdmin &&
              typeof data.error === "string" &&
              /sécurité|securite/i.test(data.error)
            ) {
              setNeedsSecurityCode(true);
            }
            setError(errMsg);
            return;
          }

          if (typeof data.token !== "string" || !data.token || typeof data.role !== "string" || !data.role) {
            setError("Réponse de connexion incomplète. Vérifiez que l’API est joignable.");
            return;
          }

          if (isAdmin && data.role === "vendor") {
            setError("Ce compte est un compte vendeur. Veuillez utiliser l'espace Vendeurs/Revendeurs.");
            return;
          }
          if (!isAdmin && (data.role === "admin" || data.role === "manager" || data.role === "collaborateur")) {
            setError("Ce compte est un compte administrateur. Veuillez utiliser l'espace Administrateurs/Gérant de zone.");
            return;
          }

          type VendorInfo = { id: number; name: string; email: string | null; username: string };
          const manager = data.manager as { name?: string; username?: string; routerIds?: number[]; routerId?: number | null } | undefined;
          const collaborateur = data.collaborateur as { name?: string; username?: string; routerIds?: number[] } | undefined;
          const admin = data.admin as { displayName?: string | null; login?: string | null } | undefined;
          const vendor = data.vendor as VendorInfo | undefined;

          const connectedName: string | null =
            data.role === "manager"       ? (manager?.name ?? null) :
            data.role === "collaborateur" ? (collaborateur?.name ?? null) :
            data.role === "admin"         ? (admin?.displayName ?? admin?.login ?? null) :
            null;
          const connectedUsername: string | null =
            data.role === "manager"       ? (manager?.username ?? null) :
            data.role === "collaborateur" ? (collaborateur?.username ?? null) :
            data.role === "admin"         ? (admin?.login ?? null) :
            null;
          login(
            data.token,
            data.role as UserRole,
            vendor ?? undefined,
            manager?.routerIds?.length
              ? manager.routerIds
              : manager?.routerId != null
                ? [manager.routerId]
                : undefined,
            collaborateur?.routerIds ?? undefined,
            apkLogin || remember,
            data.isSuperAdmin === true,
            connectedName,
            connectedUsername,
          );
          if (data.role === "vendor") {
            navigate("/vendeur");
          } else if (data.role === "manager" || data.role === "collaborateur") {
            navigate("/");
          } else {
            navigate("/routers");
          }
          return;
        } catch (err) {
          if (err instanceof Error && err.message === "INVALID_JSON") {
            setError("Réponse serveur invalide. Vérifiez que l’API est joignable sur https://nanovoucher.com");
            return;
          }
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          setError(describeFetchFailure(err));
        }
      }
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
          <BrandLogo size="xl" className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">nanoTECH Vouchers</h1>
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
                autoComplete="username"
                required
              />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">Mot de passe</Label>
              <PasswordInput
                className="mt-1 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>

            {isAdmin && needsSecurityCode && (
              <div>
                <Label className="text-gray-300 text-sm flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                  Code de sécurité
                </Label>
                <Input
                  className="mt-1 bg-gray-800 border-amber-700/50 text-white placeholder:text-gray-500 focus:border-amber-500"
                  placeholder="Code super-admin"
                  value={securityCode}
                  onChange={(e) => setSecurityCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </div>
            )}

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
