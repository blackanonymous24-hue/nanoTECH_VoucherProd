import { useEffect, useMemo, useRef, useState } from "react";
import { fetchServerTemplate } from "@/pages/TicketTemplate";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type HotspotUser = {
  username: string;
  password: string;
  profile?: string | null;
  comment?: string | null;
  limitUptime?: string | null;
  limitBytesTotal?: string | null;
};

type HotspotProfile = { name: string; price?: string | null; validity?: string | null };
type RouterRow = { id: number; name: string; hotspotName?: string | null; contact?: string | null };

export default function VoucherPrint() {
  const [htmlItems, setHtmlItems] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const renderedRef = useRef<HTMLDivElement | null>(null);
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const lotId = query.get("id")?.trim() ?? "";
  const cacheKey = useMemo(() => `voucher-print-cache:${lotId}`, [lotId]);

  const waitAndPrint = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const root = renderedRef.current;
    if (!root) {
      window.print();
      return;
    }
    const imgs = Array.from(root.querySelectorAll("img"));
    if (imgs.length === 0) {
      window.print();
      return;
    }
    await Promise.race([
      Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
      ),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1800)),
    ]);
    window.print();
  };

  useEffect(() => {
    if (htmlItems.length === 0) return;
    const triggerPrint = () => {
      void waitAndPrint();
    };
    triggerPrint();
    const onPageShow = () => triggerPrint();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [htmlItems]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as { html?: string[] };
      if (Array.isArray(cached.html) && cached.html.length > 0) {
        setHtmlItems(cached.html);
        setLoading(false);
      }
    } catch {
      // ignore malformed cache
    }
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!lotId) throw new Error("Paramètre id manquant.");
        const routerRaw = localStorage.getItem("vouchernet_router_id");
        const routerId = routerRaw ? Number.parseInt(routerRaw, 10) : NaN;
        if (!Number.isFinite(routerId)) throw new Error("Aucun routeur actif dans cette session.");

        const [php, usersResp, profilesResp, routersResp] = await Promise.all([
          fetchServerTemplate(),
          fetch(`${BASE}/api/routers/${routerId}/users?comment=${encodeURIComponent(lotId)}&limit=2500`),
          fetch(`${BASE}/api/routers/${routerId}/profiles?refresh=1`),
          fetch(`${BASE}/api/routers`),
        ]);
        if (!usersResp.ok) throw new Error(`Chargement vouchers impossible (HTTP ${usersResp.status}).`);
        if (!profilesResp.ok) throw new Error(`Chargement profils impossible (HTTP ${profilesResp.status}).`);
        if (!routersResp.ok) throw new Error(`Chargement routeurs impossible (HTTP ${routersResp.status}).`);

        const usersData = (await usersResp.json()) as { users?: HotspotUser[] };
        const profiles = (await profilesResp.json()) as HotspotProfile[];
        const routers = (await routersResp.json()) as RouterRow[];
        const users = (usersData.users ?? []).filter((u) => (u.comment ?? "").trim() === lotId);
        if (users.length === 0) throw new Error("Aucun voucher trouvé pour ce lot.");

        const router = routers.find((r) => r.id === routerId);
        const hotspotName = router?.hotspotName || router?.name || "";
        const dnsname = router?.contact || "";
        const vouchers = users.map((u, idx) => {
          const p = profiles.find((x) => x.name === (u.profile ?? ""));
          return {
            hotspotname: hotspotName,
            dnsname,
            username: u.username,
            password: u.password,
            price: p?.price ?? "",
            currency: "FCFA",
            validity: p?.validity ?? "",
            timelimit: u.limitUptime ?? "",
            datalimit: u.limitBytesTotal ?? "",
            num: idx + 1,
          };
        });

        const renderResp = await fetch(`${BASE}/api/render-tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ php, vouchers }),
        });
        const payload = (await renderResp.json().catch(() => ({}))) as { html?: string[]; error?: string };
        if (!renderResp.ok || payload.error) throw new Error(payload.error || `HTTP ${renderResp.status}`);
        if (!payload.html || payload.html.length === 0) throw new Error("Le template n'a généré aucun ticket.");

        if (!cancelled) {
          setHtmlItems(payload.html);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ html: payload.html }));
          } catch {
            // ignore storage quota errors
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lotId]);

  if (loading) return <div className="p-4 text-sm text-gray-600">Préparation de l'impression…</div>;
  if (error) return <div className="p-4 text-sm text-red-600">Erreur impression: {error}</div>;
  return (
    <div ref={renderedRef}>
      <div className="no-print p-3 border-b border-gray-200 bg-white sticky top-0 z-10">
        <button
          type="button"
          onClick={() => {
            void waitAndPrint();
          }}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          Réimprimer maintenant
        </button>
      </div>
      {htmlItems.map((h, i) => <div key={i} dangerouslySetInnerHTML={{ __html: h }} />)}
    </div>
  );
}

