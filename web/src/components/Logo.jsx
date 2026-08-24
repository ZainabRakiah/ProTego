import * as React from "react";
import { ProTegoLogo } from "@/components/ProTegoLogo";
import { cn } from "@/lib/utils";

/**
 * Brand mark.
 *
 * Renders the built-in ProTego mark by default. Drop a file at
 * `web/public/logo.png` and it takes over automatically — no code change.
 * Set VITE_LOGO_SRC to point at a different filename or path.
 */
const LOGO_SRC = import.meta.env.VITE_LOGO_SRC || "/logo.png";

/*
 * Shared across instances: without this, every mark on the page would request
 * the missing override and log its own 404. One failure is enough to know.
 */
let overrideMissing = false;

export function LogoMark({ className, size = 36 }) {
  const [failed, setFailed] = React.useState(overrideMissing);

  if (!failed) {
    return (
      <img
        src={LOGO_SRC}
        alt=""
        width={size}
        height={size}
        onError={() => {
          overrideMissing = true;
          setFailed(true);
        }}
        className={cn("shrink-0 rounded-xl object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <ProTegoLogo
      size={size}
      variant="tile"
      className={cn("rounded-[22%] shadow-lg shadow-primary/25", className)}
    />
  );
}

export function Logo({ className, size = 36, showText = true }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showText ? (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">ProTego</span>
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            Night safety
          </span>
        </span>
      ) : null}
    </div>
  );
}
