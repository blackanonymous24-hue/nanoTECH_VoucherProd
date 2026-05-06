---
name: mobile-ticket-print
description: Comportement CSS et HTML pour l'impression de tickets Wi-Fi (MikHmon/MikroTik) depuis un navigateur mobile (Safari iOS, Chrome Android). Couvre les anti-coupures, le débordement horizontal, la bordure droite, le numéro de ticket, et la correction du triangle décoratif CSS. Utiliser quand l'utilisateur signale des tickets coupés entre pages, des colonnes qui débordent, ou des bordures masquées à l'impression mobile.
---

# Impression mobile de tickets Wi-Fi (VoucherNet)

## Fichier principal
`artifacts/app/src/lib/print.ts` — fonction `buildHtml()`, chemin `if (mobile)`.

## Règles fondamentales

### 1. Anti-coupure entre pages (solution radicale)
Ne PAS se fier à `break-inside:avoid` seul (non fiable sur Safari iOS print).  
**Solution : blocs de page explicites avec `page-break-after:always` forcé.**

```ts
const MOBILE_COLS = 4;        // 4 colonnes (zoom compense le débordement)
const rowsPerPage = 6;        // fixe — 4×6 = 24 tickets par bloc
const perPage = MOBILE_COLS * rowsPerPage;

for (let p = 0; p < htmlItems.length; p += perPage) {
  const isLast = p + perPage >= htmlItems.length;
  const breakStyle = isLast ? "" : "page-break-after:always;break-after:page;";
  blocks.push(
    `<div class="ticket-page-wrap" style="${breakStyle}"><table ...>...</table></div>`
  );
}
```

En CSS, renforcer avec :
```css
.ticket-page-wrap + .ticket-page-wrap { page-break-before: always; break-before: page; }
.ticket-row { break-inside: avoid; page-break-inside: avoid; }
.ticket   { display: block; break-inside: avoid; page-break-inside: avoid; }
```

### 2. Débordement horizontal (4 colonnes sur A4)
4 × 215px = 860px > 794px (A4 portrait sans marges).  
**Solution : `zoom: s` sur `html` — élargit la zone de contenu à 794/s px.**  
Avec zoom 85% → zone disponible = 934px > 860px ✓

```css
html { zoom: ${s}; margin: 0; padding: 0; }
```

Ne PAS utiliser `transform: scale()` sur `body` → casse `break-inside`.  
Ne PAS utiliser `zoom` sur `body` → moins fiable que sur `html`.

### 3. @page — DOIT être à la racine
```css
/* Toujours hors @media print, à la racine du <style> */
@page        { margin: 0; }
@page :first { margin: 0; }
@page :left  { margin: 0; }
@page :right { margin: 0; }
```
Safari iOS ignore `@page` s'il est dans `@media print`.

### 4. Overflow — ciblage chirurgical
```css
/* Fix Safari : overflow:hidden sur ancêtres coupe le contenu aux sauts de page */
body, .ticket-page-wrap, table.ticket-page, .ticket-row, .ticket-row > td {
  overflow: visible !important;
}
/* MAIS : .ticket > table a besoin de overflow:hidden pour contenir le triangle décoratif */
.ticket > table {
  display: table !important;
  overflow: hidden !important;
  position: relative !important;  /* OBLIGATOIRE pour que overflow:hidden clippe les position:absolute */
}
```

### 5. Template PHP — `display:inline-block` à corriger
```css
/* Le template MikHmon génère <table style="display:inline-block"> → casse break-inside */
.ticket > table { display: table !important; }
.ticket img { float: none !important; display: inline-block !important; }
```

### 6. Triangle décoratif CSS (bordure droite masquée)
Le template PHP contient :
```html
<div style="position:absolute;border-top:230px solid transparent;border-right:170px solid #DCDCDC;..."></div>
```
Ce triangle déborde à droite si le conteneur n'est pas clippé.  
**Solution : envelopper la `<table>` du ticket dans un `<div>` (pas juste mettre overflow sur table — unreliable).**

```html
<!--mks-mulai-->
<div style="display:inline-block;width:215px;overflow:hidden;position:relative;">
  <table style="border:1px solid #444;width:215px;...">
    ...
  </table>
</div>
<!--mks-akhir-->
```

Appliquer via SQL REPLACE sur `admin_settings.ticket_template` :
```sql
UPDATE admin_settings
SET ticket_template = REPLACE(
  REPLACE(ticket_template,
    '<!--mks-mulai-->',
    '<!--mks-mulai--><div style="display:inline-block;width:215px;overflow:hidden;position:relative;">'
  ),
  '<!--mks-akhir-->',
  '</div><!--mks-akhir-->'
)
WHERE ticket_template NOT LIKE '%display:inline-block;width:215px;overflow:hidden%';
```

### 7. Numéro de ticket aligné à droite dans le footer
```html
<!-- Remplacer text-align:left par flex + space-between -->
<div style="display:flex;justify-content:space-between;align-items:center;
            color:#fff;font-size:8px;font-weight:bold;margin:0;padding:2.5px;">
  <b><?= $dnsname; ?></b>
  <span><?= "[$num]"; ?></span>
</div>
```

## Structure HTML générée (mobile)

```html
<!doctype html>
<html>
<head>
  <style>@page { margin:0; } ...</style>
  <style>html { zoom: 0.85; } ...</style>
  <script>window.onload=function(){setTimeout(function(){window.print();},500);}</script>
</head>
<body>
  <!-- Bloc 1 (tickets 1–24), page-break-after:always -->
  <div class="ticket-page-wrap" style="page-break-after:always;break-after:page;">
    <table class="ticket-page">
      <tbody>
        <tr class="ticket-row">
          <td><div class="ticket">[ticket PHP rendu]</div></td>
          <td><div class="ticket">...</div></td>
          <td><div class="ticket">...</div></td>
          <td><div class="ticket">...</div></td>
        </tr>
        <!-- 5 autres lignes -->
      </tbody>
    </table>
  </div>
  <!-- Bloc 2 (tickets 25–48), dernier bloc sans break -->
  <div class="ticket-page-wrap">...</div>
</body>
</html>
```

## Path d'impression mobile dans le code

```
GenerateVouchers.tsx → handlePrint(lot)
  → buildTicketPrintHtml(htmlItems, title, scale, mobile=true)   [print.ts]
  → buildHtml(htmlItems, title, autoprint=true, scale, mobile=true)
  → HTML injecté dans iframe caché → window.print() après 500ms
```

## Ce qui NE fonctionne PAS (à éviter)

| Approche | Problème |
|---|---|
| `transform: scale()` sur `body` | Casse `break-inside:avoid` |
| `break-inside:avoid` seul sans blocs | Non fiable sur Safari iOS |
| `overflow:hidden` sur `<table>` | Ne clippe pas les `position:absolute` |
| `@page` dans `@media print` | Ignoré par Safari iOS |
| `* { overflow: visible !important }` | Annule le clipping du triangle décoratif |
| 4 colonnes sans zoom | 860px > 794px = débordement horizontal |
