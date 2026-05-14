import { cn } from "@/lib/utils";

/**
 * Référence type Mikhmon : libellés + extraits PHP utilisables dans les modèles de ticket.
 * - `boxed` : bloc autonome (bordure / fond).
 * - `plain` : contenu seul, à placer dans un Card parent.
 */
type TicketTemplateVarLegendProps = {
  variant?: "boxed" | "plain";
  className?: string;
};

/** Liste variables : hauteur max = zone scroll (carte sans vide sous la barre). */
const VAR_LEGEND_SCROLL =
  "max-h-[min(48vh,22rem)] overflow-y-auto overscroll-contain pr-0.5 [scrollbar-gutter:stable]";

function CodeBlock({ children, className }: { children: string; className?: string }) {
  return (
    <code
      className={cn(
        "mt-0.5 block rounded border border-violet-100 bg-violet-50/70 px-1.5 py-1 font-mono text-[10px] leading-snug text-violet-950 whitespace-pre-wrap break-all",
        className,
      )}
    >
      {children}
    </code>
  );
}

function VarRow({ title, code, note }: { title: string; code: string; note?: string }) {
  return (
    <div>
      <p className="font-sans text-[10px] font-semibold text-gray-800">{title} :</p>
      <CodeBlock>{code}</CodeBlock>
      {note ? <p className="mt-0.5 text-[9px] leading-snug text-gray-500">{note}</p> : null}
    </div>
  );
}

function MikhmonStyleVarDoc({ className }: { className?: string }) {
  const conditionalSnippet =
    "<?php if($usermode == \"vc\"){?>\n"
    + "  … HTML / PHP du mode voucher (souvent code unique) …\n"
    + "<?php }elseif($usermode == \"up\"){?>\n"
    + "  … HTML / PHP du mode user + mot de passe …\n"
    + "<?php }?>";

  return (
    <div className={cn("space-y-2.5 text-gray-700", className)}>
      <div className="mb-0.5 rounded-md border border-gray-200 bg-slate-50/90 px-2 py-1.5 font-mono text-[10px] text-gray-900 space-y-0.5">
        <div>
          <span className="text-violet-800">$hotspotname</span>
          <span className="font-sans text-gray-600"> = Nom du wifi</span>
        </div>
        <div>
          <span className="text-violet-800">$dnsname</span>
          <span className="font-sans text-gray-600"> = Contact</span>
        </div>
      </div>
      <VarRow
        title="Logo"
        code={'<img src="<?= $logo; ?>" style="height:30px;border:0;">'}
        note="Équivalent : <?php echo $logo; ?> — vide si le modèle ne définit pas de logo."
      />
      <VarRow
        title="Hotspotname"
        code={"<?= $hotspotname; ?>"}
        note="Nom du wifi (fiche routeur). Équivalent : <?php echo $hotspotname; ?>."
      />
      <VarRow title="Username" code={"<?= $username; ?>"} />
      <VarRow title="Password" code={"<?= $password; ?>"} />
      <VarRow title="Validity" code={"<?= $validity; ?>"} note="Sur les modèles nanoTECH après <!--mks-mulai-->, validité formatée (ex. Jour(s))." />
      <VarRow title="Time Limit" code={"<?= $timelimit; ?>"} />
      <VarRow title="Data Limit" code={"<?= $datalimit; ?>"} />
      <VarRow title="Price" code={"<?= $price; ?>"} />
      <VarRow title="Profile" code={"<?= $profile; ?>"} note="Peut rester vide selon le modèle et les données d’impression." />
      <VarRow title="Comment" code={"<?= $comment; ?>"} note="Peut rester vide selon le modèle et les données d’impression." />
      <VarRow
        title="DNS Name Hotspot"
        code={"<?= $dnsname; ?>"}
        note="Contact (fiche routeur) ; si vide, affichage comme l’hôte API / nom Wi-Fi. Équivalent : <?php echo $dnsname; ?>."
      />
      <VarRow title="QR Code" code={"<?= $qrcode ?>"} note="Fragment HTML (attributs img) ; <?php echo $qrcode; ?> est aussi pris en charge." />
      <div>
        <p className="font-sans text-[10px] font-semibold text-gray-800">Number Voucher :</p>
        <CodeBlock>{"<?= $num; ?>"}</CodeBlock>
        <CodeBlock className="mt-1.5">{`<span id="num"><?= " [$num]"; ?></span>`}</CodeBlock>
        <p className="mt-0.5 text-[9px] leading-snug text-gray-500">
          Variantes <code className="rounded bg-gray-100 px-0.5 font-mono">[$num]</code> avec{" "}
          <code className="rounded bg-gray-100 px-0.5 font-mono">echo</code> reconnues à l’impression.
        </p>
      </div>
      <VarRow
        title="Color (nanoTECH)"
        code={"<?php echo $color; ?>"}
        note="Palette nanoTECH (après <!--mks-mulai-->). Aussi <?= $color; ?>."
      />
      <VarRow
        title="Getprice (nanoTECH)"
        code={"<?php echo $getprice; ?>"}
        note="Clé chiffrée pour la couleur de prix (modèles nanoTECH)."
      />
      <VarRow title="Currency" code={"<?= $currency; ?>"} />
      <div>
        <p className="font-sans text-[10px] font-semibold text-gray-800">Conditional :</p>
        <CodeBlock>{conditionalSnippet}</CodeBlock>
        <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[9px] leading-snug text-gray-600">
          <li>
            <span className="font-mono text-violet-800">$usermode = &quot;vc&quot;</span> — affichage type code / voucher (souvent identifiant unique).
          </li>
          <li>
            <span className="font-mono text-violet-800">$usermode = &quot;up&quot;</span> — affichage login et mot de passe séparés (ex.{" "}
            <code className="rounded bg-gray-100 px-0.5 font-mono text-[9px]">User: … / Pass: …</code>).
          </li>
        </ul>
      </div>
      <p className="border-t border-gray-200 pt-2 text-[9px] leading-snug text-gray-500">
        À l’impression, les balises{" "}
        <span className="font-mono text-gray-700">{"<?= ... ?>"}</span>
        {" "}et{" "}
        <span className="font-mono text-gray-700">{"<?php echo ...; ?>"}</span>
        {" "}
        sont remplacées par les valeurs du voucher. Une variable absente des données reste vide.
      </p>
    </div>
  );
}

export function TicketTemplateVarLegend({ variant = "boxed", className }: TicketTemplateVarLegendProps) {
  if (variant === "plain") {
    return (
      <div className={cn("text-[11px] leading-snug", className)}>
        <MikhmonStyleVarDoc className={VAR_LEGEND_SCROLL} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-gray-200 bg-slate-50 px-2 py-1.5 text-[11px] text-gray-700 leading-snug",
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Variables</p>
      <MikhmonStyleVarDoc className={VAR_LEGEND_SCROLL} />
    </div>
  );
}
