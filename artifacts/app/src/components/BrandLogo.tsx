import { cn } from "@/lib/utils";

const LOGO_URL = `${import.meta.env.BASE_URL}nanotech-logo.png`;

type BrandLogoSize = "sm" | "md" | "lg" | "xl";

/** Logo rempli dans le cadre blanc (même rendu que la page login). */
const fillImg = "max-h-full max-w-full object-contain scale-[1.28]";

const sizes: Record<
  BrandLogoSize,
  { frame: string; img: string }
> = {
  sm: {
    frame: "h-7 w-[1.75rem] p-0 rounded-lg overflow-hidden",
    img: fillImg,
  },
  md: {
    frame: "h-9 w-[2.25rem] p-0 rounded-xl overflow-hidden",
    img: fillImg,
  },
  lg: {
    frame: "h-[4.75rem] w-[7.25rem] p-0 rounded-2xl overflow-hidden",
    img: fillImg,
  },
  xl: {
    frame: "h-28 w-[10.5rem] p-0 rounded-2xl overflow-hidden",
    img: fillImg,
  },
};

interface BrandLogoProps {
  size?: BrandLogoSize;
  className?: string;
  /** Fond blanc arrondi (menu, login). Désactivable si besoin. */
  framed?: boolean;
}

/** Logo nanoTECH — cadre blanc moderne par défaut (menu / login). */
export function BrandLogo({
  size = "md",
  className = "",
  framed = true,
}: BrandLogoProps) {
  const s = sizes[size];

  const img = (
    <img
      src={LOGO_URL}
      alt="nanoTECH"
      className={cn("object-contain flex-shrink-0", s.img)}
      draggable={false}
    />
  );

  if (!framed) {
    return (
      <div className={cn("inline-flex flex-shrink-0", className)}>{img}</div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex flex-shrink-0 items-center justify-center",
        "bg-white shadow-md shadow-black/20",
        "ring-1 ring-white/10 ring-inset",
        "border border-slate-200/90",
        s.frame,
        className,
      )}
    >
      {img}
    </div>
  );
}
