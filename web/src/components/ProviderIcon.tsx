import { useEffect, useState } from "react";
import { Boxes } from "lucide-react";

import { cn } from "@/lib/utils";

interface ProviderIconProps {
  type: string;
  size?: number;
  className?: string;
}

/**
 * Renders the provider logo shipped from aime-chat's assets/model-logos
 * (copied to web/public/model-logos). Most logos are SVG; a few providers
 * only ship PNG, so the source falls back svg -> png -> placeholder.
 */
export function ProviderIcon({ type, size = 24, className }: ProviderIconProps) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    setStage(0);
  }, [type]);

  if (stage === 2 || !type) {
    return (
      <span
        className={cn("grid shrink-0 place-items-center rounded-md bg-muted text-muted-foreground", className)}
        style={{ width: size, height: size }}
      >
        <Boxes style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }} />
      </span>
    );
  }

  return (
    <img
      src={`${import.meta.env.BASE_URL}model-logos/${type}.${stage === 0 ? "svg" : "png"}`}
      alt={`${type} logo`}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
      onError={() => setStage((current) => (current === 0 ? 1 : 2))}
    />
  );
}
