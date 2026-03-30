import { useState } from "react";
import { useGetSales, getGetSalesQueryKey } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";

export default function Sales() {
  const [page, setPage] = useState(0);
  const limit = 20;
  
  const { data: sales, isLoading } = useGetSales({ limit, offset: page * limit }, {
    query: { queryKey: getGetSalesQueryKey({ limit, offset: page * limit }) }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Historique des Ventes</h1>
          <p className="text-muted-foreground mt-1">Traçabilité complète de toutes les transactions.</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Date & Heure</TableHead>
                  <TableHead>Code Voucher</TableHead>
                  <TableHead>Forfait</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Paiement</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Opérateur</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : sales && sales.length > 0 ? (
                  sales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(sale.createdAt)}</TableCell>
                      <TableCell className="font-mono font-bold text-foreground">{sale.voucherCode}</TableCell>
                      <TableCell className="font-medium">{sale.profileName}</TableCell>
                      <TableCell className="font-semibold text-primary">{formatCurrency(sale.amount)}</TableCell>
                      <TableCell>{sale.paymentMethod}</TableCell>
                      <TableCell>{sale.customerName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{sale.operatorName || "—"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground flex-col gap-2">
                      <div className="flex flex-col items-center justify-center w-full h-full">
                        <FileText className="h-8 w-8 mb-2 opacity-20" />
                        Aucune vente enregistrée pour le moment.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-muted-foreground">
              {sales ? `Page ${page + 1}` : ""}
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0 || isLoading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Précédent
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => p + 1)}
                disabled={!sales || sales.length < limit || isLoading}
              >
                Suivant <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
