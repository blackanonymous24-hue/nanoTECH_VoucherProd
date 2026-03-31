import { useState } from "react";
import { useLocation } from "wouter";
import { useVendorAuth } from "@/context/vendor-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wifi, LogIn, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function VendorLogin() {
  const { login } = useVendorAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !pin.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/vendors/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), pin: pin.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Connexion impossible",
          description: data.error ?? "Numéro de téléphone ou PIN incorrect",
          variant: "destructive",
        });
        return;
      }
      const session = await res.json();
      login(session);
      navigate("/vendeur/vente");
    } catch {
      toast({
        title: "Erreur réseau",
        description: "Impossible de contacter le serveur",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Wifi className="h-10 w-10 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">VoucherNet</h1>
          <p className="text-muted-foreground">Espace Vendeur</p>
        </div>

        <Card>
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Connexion</CardTitle>
            <CardDescription>
              Entrez votre numéro de téléphone et votre code PIN
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Numéro de téléphone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="034 xx xxx xx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin">Code PIN</Label>
                <div className="relative">
                  <Input
                    id="pin"
                    type={showPin ? "text" : "password"}
                    placeholder="••••"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoComplete="current-password"
                    disabled={isLoading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPin((v) => !v)}
                    tabIndex={-1}
                  >
                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading || !phone || !pin}>
                <LogIn className="h-4 w-4 mr-2" />
                {isLoading ? "Connexion..." : "Se connecter"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Contactez votre administrateur si vous avez oublié votre PIN.
        </p>
      </div>
    </div>
  );
}
