import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  KeyRound,
  Router,
  CheckCircle2,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SetupWizardProps {
  open: boolean;
  onComplete: () => void;
}

type Step = "password" | "router" | "done";

export default function SetupWizard({ open, onComplete }: SetupWizardProps) {
  const { token } = useAuth();
  const [step, setStep] = useState<Step>("password");

  // Password step state
  const [newLogin, setNewLogin]       = useState("admin");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPwd, setConfirmPwd]   = useState("");
  const [pwdError, setPwdError]       = useState("");
  const [pwdLoading, setPwdLoading]   = useState(false);

  // Router step state
  const [routerName, setRouterName]         = useState("");
  const [routerHost, setRouterHost]         = useState("");
  const [routerPort, setRouterPort]         = useState("8728");
  const [routerUsername, setRouterUsername] = useState("");
  const [routerPassword, setRouterPassword] = useState("");
  const [routerError, setRouterError]       = useState("");
  const [routerLoading, setRouterLoading]   = useState(false);
  const [skipRouter, setSkipRouter]         = useState(false);

  useEffect(() => {
    if (open) {
      setStep("password");
      setNewLogin("admin");
      setNewPassword("");
      setConfirmPwd("");
      setPwdError("");
      setPwdLoading(false);
      setRouterName("");
      setRouterHost("");
      setRouterPort("8728");
      setRouterUsername("");
      setRouterPassword("");
      setRouterError("");
      setRouterLoading(false);
      setSkipRouter(false);
    }
  }, [open]);

  async function handlePasswordSave() {
    setPwdError("");
    if (!newLogin.trim()) {
      setPwdError("L'identifiant est requis."); return;
    }
    if (!newPassword) {
      setPwdError("Le nouveau mot de passe est requis."); return;
    }
    if (newPassword.length < 4) {
      setPwdError("Le mot de passe doit comporter au moins 4 caractères."); return;
    }
    if (newPassword !== confirmPwd) {
      setPwdError("Les mots de passe ne correspondent pas."); return;
    }

    setPwdLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/credentials`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ login: newLogin.trim(), password: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setPwdError(data.error ?? "Erreur inconnue");
      } else {
        setStep("router");
      }
    } catch {
      setPwdError("Erreur réseau. Réessayez.");
    } finally {
      setPwdLoading(false);
    }
  }

  async function handleRouterSave() {
    setRouterError("");
    if (!routerName.trim() || !routerHost.trim() || !routerUsername.trim() || !routerPassword.trim()) {
      setRouterError("Tous les champs sont requis."); return;
    }
    const port = parseInt(routerPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setRouterError("Le port doit être un nombre valide."); return;
    }

    setRouterLoading(true);
    try {
      const res = await fetch(`${BASE}/api/routers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: routerName.trim(),
          host: routerHost.trim(),
          port,
          username: routerUsername.trim(),
          password: routerPassword,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setRouterError(data.error ?? "Erreur inconnue");
      } else {
        setStep("done");
      }
    } catch {
      setRouterError("Erreur réseau. Réessayez.");
    } finally {
      setRouterLoading(false);
    }
  }

  function handleSkipRouter() {
    setSkipRouter(true);
    setStep("done");
  }

  const steps: { key: Step; label: string }[] = [
    { key: "password", label: "Mot de passe" },
    { key: "router",   label: "Routeur" },
    { key: "done",     label: "Terminé" },
  ];
  const currentStepIndex = steps.findIndex((s) => s.key === step);

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Assistant de première configuration
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 py-1">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold flex-shrink-0 transition-colors ${
                i < currentStepIndex
                  ? "bg-emerald-500 text-white"
                  : i === currentStepIndex
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-500"
              }`}>
                {i < currentStepIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${
                i === currentStepIndex ? "text-gray-900" : "text-gray-400"
              }`}>
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <ChevronRight className="h-3 w-3 text-gray-300 flex-shrink-0 ml-auto" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Password */}
        {step === "password" && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <KeyRound className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Changez le mot de passe par défaut</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Le mot de passe actuel est <code className="bg-amber-100 px-1 rounded">root</code>. Choisissez un mot de passe sécurisé avant de continuer.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Identifiant admin</Label>
                <Input
                  value={newLogin}
                  onChange={(e) => setNewLogin(e.target.value)}
                  placeholder="admin"
                  className="h-9 text-sm"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nouveau mot de passe</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="4 caractères minimum"
                  className="h-9 text-sm"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Confirmer le mot de passe</Label>
                <Input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="••••••••"
                  className="h-9 text-sm"
                  autoComplete="new-password"
                  onKeyDown={(e) => e.key === "Enter" && void handlePasswordSave()}
                />
              </div>
              {pwdError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pwdError}</p>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={() => void handlePasswordSave()} disabled={pwdLoading} className="gap-2">
                {pwdLoading ? "Enregistrement…" : "Enregistrer et continuer"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Router */}
        {step === "router" && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Router className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800">Ajoutez votre premier routeur MikroTik</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Connectez votre routeur pour commencer à gérer vos vouchers.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Nom du routeur</Label>
                  <Input
                    value={routerName}
                    onChange={(e) => setRouterName(e.target.value)}
                    placeholder="Routeur Principal"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Hôte (IP)</Label>
                  <Input
                    value={routerHost}
                    onChange={(e) => setRouterHost(e.target.value)}
                    placeholder="192.168.1.1"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Port API</Label>
                  <Input
                    value={routerPort}
                    onChange={(e) => setRouterPort(e.target.value)}
                    placeholder="8728"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Identifiant MikroTik</Label>
                  <Input
                    value={routerUsername}
                    onChange={(e) => setRouterUsername(e.target.value)}
                    placeholder="admin"
                    className="h-9 text-sm"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Mot de passe MikroTik</Label>
                  <Input
                    type="password"
                    value={routerPassword}
                    onChange={(e) => setRouterPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-9 text-sm"
                    autoComplete="off"
                  />
                </div>
              </div>
              {routerError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{routerError}</p>
              )}
            </div>

            <div className="flex justify-between pt-1">
              <Button variant="ghost" onClick={handleSkipRouter} className="text-gray-500 text-sm">
                Passer cette étape
              </Button>
              <Button onClick={() => void handleRouterSave()} disabled={routerLoading} className="gap-2">
                {routerLoading ? "Enregistrement…" : "Ajouter le routeur"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-900">Configuration terminée !</p>
              <p className="text-sm text-gray-500 mt-1">
                {skipRouter
                  ? "Vous pourrez ajouter des routeurs depuis la page Routeurs."
                  : "Votre premier routeur a été ajouté. Vous pouvez maintenant utiliser VoucherNet."}
              </p>
            </div>
            <Button onClick={onComplete} className="mt-2">
              Accéder au tableau de bord
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
