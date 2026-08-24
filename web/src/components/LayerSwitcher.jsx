import * as React from "react";
import { Layers, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAP_LAYERS } from "@/lib/mapLayers";
import { cn } from "@/lib/utils";

/**
 * Basemap picker that floats over the map.
 *
 * Collapses to an icon button on small screens; on md+ the options are laid
 * out as a row of labelled tiles, since there are only four.
 */
export function LayerSwitcher({ value, onChange, className }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <Button
        variant="outline"
        size="icon"
        className="shadow-lg"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change map view"
        aria-expanded={open}
        title="Change map view"
      >
        <Layers className="size-4" />
      </Button>

      {open ? (
        <div
          role="radiogroup"
          aria-label="Map view"
          className="surface animate-rise absolute right-0 bottom-full mb-2 w-56 rounded-xl border border-border p-1.5"
        >
          <p className="px-2 pt-1 pb-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
            Map view
          </p>
          {MAP_LAYERS.map((layer) => {
            const Icon = layer.icon;
            const active = layer.id === value;
            return (
              <button
                key={layer.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onChange(layer.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{layer.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {layer.description}
                  </span>
                </span>
                {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
