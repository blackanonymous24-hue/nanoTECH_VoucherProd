import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetVoucherBatches,
  getGetVoucherBatchesQueryKey,
  useGetVouchersByBatch,
  useDeleteVoucherBatch,
  useGetProfiles,
  getGetProfilesQueryKey,
  useGenerateVouchers,
  useDeleteVoucher,
  useGetVouchers,
  getGetVouchersQueryKey,
  useImportVouchers,
} from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, Plus, Download, Upload, FileText, PackageOpen, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

// ── helpers ──────────────────────────────────────────────────────────────────

function getStatusColor(status: string) {
  switch (status) {
    case "available": return "bg-blue-500/10 text-blue-600 border-blue-200";
    case "sold": return "bg-green-500/10 text-green-600 border-green-200";
    case "used": return "bg-orange-500/10 text-orange-600 border-orange-200";
    case "expired": return "bg-gray-500/10 text-gray-600 border-gray-200";
    default: return "";
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case "available": return "Disponible";
    case "sold": return "Vendu";
    case "used": return "Utilisé";
    case "expired": return "Expiré";
    default: return status;
  }
}

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Batch detail dialog ───────────────────────────────────────────────────────

function BatchDetailDialog({
  batchId,
  batchName,
  profileName,
}: {
  batchId: string;
  batchName: string;
  profileName: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: vouchers, isLoading } = useGetVouchersByBatch(
    { batchId },
    { query: { enabled: open } }
  );

  const exportTxt = () => {
    if (!vouchers) return;
    const available = vouchers.filter((v) => v.status === "available");
    const lines = [
      `=== ${batchName} ===`,
      `Forfait : ${profileName}`,
      `Total : ${vouchers.length} codes — Disponibles : ${available.length} — Vendus : ${vouchers.length - available.length}`,
      `Généré le : ${new Date().toLocaleString("fr-FR")}`,
      "",
      "CODES DISPONIBLES :",
      ...available.map((v) => v.code),
    ];
    downloadText(lines.join("\n"), `${batchId}.txt`);
  };

  const exportCsv = () => {
    if (!vouchers) return;
    const available = vouchers.filter((v) => v.status === "available");
    const header = "Name,Password,Profile,Comment";
    const rows = available.map((v) => `${v.code},${v.code},${profileName},`);
    downloadCSV([header, ...rows].join("\n"), `${batchId}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Voir les codes">
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{batchName}</DialogTitle>
          <DialogDescription>Forfait : {profileName}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="outline" className="gap-2" onClick={exportTxt} disabled={!vouchers}>
            <FileText className="h-4 w-4" /> Exporter .txt
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={exportCsv} disabled={!vouchers}>
            <Download className="h-4 w-4" /> Exporter .csv
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Vendu le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers?.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono font-medium">{v.code}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getStatusColor(v.status)}>
                        {getStatusLabel(v.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {v.soldAt ? formatDate(v.soldAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Import dialog ─────────────────────────────────────────────────────────────

function ImportDialog({ profiles }: { profiles?: { id: number; name: string; price: number }[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [batchName, setBatchName] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const importVouchers = useImportVouchers();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvContent(ev.target?.result as string ?? "");
    reader.readAsText(file, "utf-8");
  };

  const handleImport = () => {
    if (!profileId || !csvContent) return;
    importVouchers.mutate(
      { data: { profileId: parseInt(profileId), csvContent, batchName: batchName || undefined } },
      {
        onSuccess: (res) => {
          toast({ title: "Import réussi", description: `${res.count} codes importés avec succès.` });
          setOpen(false);
          setCsvContent("");
          setBatchName("");
          setProfileId("");
          if (fileRef.current) fileRef.current.value = "";
          queryClient.invalidateQueries({ queryKey: getGetVoucherBatchesQueryKey() });
        },
        onError: () => {
          toast({ variant: "destructive", title: "Erreur", description: "Impossible d'importer le fichier." });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" /> Importer MikHmon
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importer des tickets MikHmon</DialogTitle>
          <DialogDescription>
            Importez un fichier .csv exporté depuis MikHmon. Les codes de la colonne "Name" seront importés comme vouchers disponibles.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Forfait associé</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un forfait" />
              </SelectTrigger>
              <SelectContent>
                {profiles?.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name} — {formatCurrency(p.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Nom du lot (optionnel)</Label>
            <Input
              placeholder="Ex: Import 31/03 — 1 heure"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Fichier CSV MikHmon</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFile}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
            />
            {csvContent && (
              <p className="text-xs text-green-600">
                Fichier chargé ({csvContent.split("\n").length} lignes)
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
          <Button
            onClick={handleImport}
            disabled={importVouchers.isPending || !profileId || !csvContent}
          >
            {importVouchers.isPending ? "Importation..." : "Importer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Generate dialog ───────────────────────────────────────────────────────────

function GenerateDialog({ profiles }: { profiles?: { id: number; name: string; price: number }[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [genProfileId, setGenProfileId] = useState("");
  const [genQuantity, setGenQuantity] = useState("10");

  const generateVouchers = useGenerateVouchers();

  const handleGenerate = () => {
    if (!genProfileId || !genQuantity) return;
    generateVouchers.mutate(
      { data: { profileId: parseInt(genProfileId), quantity: parseInt(genQuantity) } },
      {
        onSuccess: (res) => {
          toast({ title: "Vouchers générés", description: `${res.count} codes créés avec succès.` });
          setOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetVoucherBatchesQueryKey() });
        },
        onError: () => {
          toast({ variant: "destructive", title: "Erreur", description: "Impossible de générer les vouchers." });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Générer en lot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Générer des vouchers</DialogTitle>
          <DialogDescription>
            Créez une série de codes aléatoires prêts à être vendus pour un forfait donné.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Forfait</Label>
            <Select value={genProfileId} onValueChange={setGenProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un forfait" />
              </SelectTrigger>
              <SelectContent>
                {profiles?.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name} — {formatCurrency(p.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Quantité à générer</Label>
            <Input
              type="number"
              min="1"
              max="1000"
              value={genQuantity}
              onChange={(e) => setGenQuantity(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={handleGenerate} disabled={generateVouchers.isPending || !genProfileId}>
            {generateVouchers.isPending ? "Génération..." : "Générer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Vouchers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profiles } = useGetProfiles({ query: { queryKey: getGetProfilesQueryKey() } });
  const { data: batches, isLoading: batchesLoading } = useGetVoucherBatches({
    query: { queryKey: getGetVoucherBatchesQueryKey() },
  });

  const deleteVoucherBatch = useDeleteVoucherBatch();
  const deleteVoucher = useDeleteVoucher();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [profileFilter, setProfileFilter] = useState<string>("all");

  const queryParams = {
    ...(statusFilter !== "all" ? { status: statusFilter as any } : {}),
    ...(profileFilter !== "all" ? { profileId: parseInt(profileFilter) } : {}),
  };
  const { data: vouchers, isLoading: vouchersLoading } = useGetVouchers(queryParams, {
    query: { queryKey: getGetVouchersQueryKey(queryParams) },
  });

  const handleDeleteBatch = (batchId: string, batchName: string) => {
    if (!confirm(`Supprimer tous les codes DISPONIBLES du lot "${batchName}" ?\nLes codes déjà vendus ne seront pas supprimés.`)) return;
    deleteVoucherBatch.mutate(
      { batchId },
      {
        onSuccess: (res) => {
          toast({ title: `${res.deleted} code(s) supprimé(s)` });
          queryClient.invalidateQueries({ queryKey: getGetVoucherBatchesQueryKey() });
        },
        onError: () => {
          toast({ variant: "destructive", title: "Erreur lors de la suppression" });
        },
      }
    );
  };

  const handleDeleteVoucher = (id: number) => {
    if (!confirm("Supprimer ce voucher ?")) return;
    deleteVoucher.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Voucher supprimé" });
          queryClient.invalidateQueries({ queryKey: getGetVouchersQueryKey() });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestion des Vouchers</h1>
          <p className="text-muted-foreground mt-1">Gérez vos lots de codes d'accès Wi-Fi.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ImportDialog profiles={profiles} />
          <GenerateDialog profiles={profiles} />
        </div>
      </div>

      <Tabs defaultValue="lots">
        <TabsList>
          <TabsTrigger value="lots" className="gap-2">
            <PackageOpen className="h-4 w-4" /> Par lot
          </TabsTrigger>
          <TabsTrigger value="tous">Tous les codes</TabsTrigger>
        </TabsList>

        {/* ── TAB : Par lot ─────────────────────────────────────────────── */}
        <TabsContent value="lots" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lot</TableHead>
                      <TableHead>Forfait</TableHead>
                      <TableHead className="text-center">Total</TableHead>
                      <TableHead className="text-center">Disponibles</TableHead>
                      <TableHead className="text-center">Vendus</TableHead>
                      <TableHead>Créé le</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchesLoading
                      ? Array.from({ length: 4 }).map((_, i) => (
                          <TableRow key={i}>
                            {Array.from({ length: 7 }).map((__, j) => (
                              <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                            ))}
                          </TableRow>
                        ))
                      : batches && batches.length > 0
                      ? batches.map((batch) => (
                          <TableRow key={batch.batchId} className="group">
                            <TableCell>
                              <p className="font-medium text-sm">{batch.batchName}</p>
                              <p className="text-xs text-muted-foreground font-mono">{batch.batchId}</p>
                            </TableCell>
                            <TableCell className="font-medium">{batch.profileName}</TableCell>
                            <TableCell className="text-center font-bold">{batch.total}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200">
                                {batch.available}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">
                                {batch.sold}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {formatDate(batch.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <BatchDetailDialog
                                  batchId={batch.batchId}
                                  batchName={batch.batchName}
                                  profileName={batch.profileName}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => handleDeleteBatch(batch.batchId, batch.batchName)}
                                  title="Supprimer les codes disponibles du lot"
                                  disabled={batch.available === 0}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      : (
                          <TableRow>
                            <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                              Aucun lot de vouchers. Générez ou importez des codes pour commencer.
                            </TableCell>
                          </TableRow>
                        )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB : Tous les codes ──────────────────────────────────────── */}
        <TabsContent value="tous" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-col sm:flex-row gap-3 p-4 border-b bg-muted/20">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Tous les statuts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les statuts</SelectItem>
                    <SelectItem value="available">Disponibles</SelectItem>
                    <SelectItem value="sold">Vendus</SelectItem>
                    <SelectItem value="used">Utilisés</SelectItem>
                    <SelectItem value="expired">Expirés</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={profileFilter} onValueChange={setProfileFilter}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Tous les forfaits" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les forfaits</SelectItem>
                    {profiles?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Forfait</TableHead>
                      <TableHead>Lot</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Créé le</TableHead>
                      <TableHead>Vendu le</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vouchersLoading
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            {Array.from({ length: 7 }).map((__, j) => (
                              <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                            ))}
                          </TableRow>
                        ))
                      : vouchers && vouchers.length > 0
                      ? vouchers.map((v) => (
                          <TableRow key={v.id} className="group">
                            <TableCell className="font-mono font-medium">{v.code}</TableCell>
                            <TableCell>{v.profileName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                              {v.batchName ?? "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getStatusColor(v.status)}>
                                {getStatusLabel(v.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{formatDate(v.createdAt)}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {v.soldAt ? formatDate(v.soldAt) : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 transition-opacity"
                                onClick={() => handleDeleteVoucher(v.id)}
                                disabled={v.status !== "available"}
                                title={v.status !== "available" ? "Impossible de supprimer un code déjà vendu" : "Supprimer"}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      : (
                          <TableRow>
                            <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                              Aucun voucher ne correspond à vos critères.
                            </TableCell>
                          </TableRow>
                        )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
