import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { geocode } from "@/lib/geo";
import { cn } from "@/lib/utils";

/*
 * Only one suggestion list may be open at a time. Each field used to track its
 * own open state, so focusing Start while Destination still had results left
 * two overlapping dropdowns on screen — one of them showing stale results for
 * a different query.
 */
const OPEN_EVENT = "protego:placesearch-open";
let nextFieldId = 0;

/**
 * Debounced place search restricted to India (see lib/geo.js).
 *
 * Fully keyboard driven: arrows move the active option, Enter picks it,
 * Escape closes — wired to the combobox/listbox ARIA pattern.
 */
export function PlaceSearch({
  id,
  label,
  value,
  onChange,
  onPick,
  placeholder,
  icon: Icon = Search,
  trailing,
  className,
}) {
  const [results, setResults] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const boxRef = React.useRef(null);
  const fieldId = React.useRef(null);
  if (fieldId.current === null) fieldId.current = ++nextFieldId;

  // Announce when this field opens; every other field closes itself.
  const openList = React.useCallback(() => {
    setOpen(true);
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: fieldId.current }));
  }, []);

  React.useEffect(() => {
    const onOtherOpened = (e) => {
      if (e.detail !== fieldId.current) setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onOtherOpened);
    return () => window.removeEventListener(OPEN_EVENT, onOtherOpened);
  }, []);

  React.useEffect(() => {
    if (!value || value.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await geocode(value, { signal: ctl.signal }));
        setActive(-1);
        openList();
      } catch {
        /* search is best-effort; the rest of the form still works */
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [value, openList]);

  React.useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      onPick(results[active]);
      setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={cn("relative", className)} ref={boxRef}>
      {label ? (
        <Label htmlFor={id} className="mb-1.5 block">
          {label}
        </Label>
      ) : null}

      <div className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => results.length && openList()}
          className="pr-16 pl-9"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {searching ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
          {trailing}
        </div>
      </div>

      {open ? (
        <ul
          role="listbox"
          className="surface absolute top-full right-0 left-0 z-[1000] mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-border p-1"
        >
          {results.length === 0 ? (
            <li className="px-2.5 py-3 text-xs text-muted-foreground">
              No places found in India for “{value}”.
            </li>
          ) : (
            results.map((r, i) => (
              <React.Fragment key={r.id ?? `${r.lat},${r.lng}`}>
                {/* Header before the first far result, so a match in another
                    state is never mistaken for one down the road. */}
                {!r.nearby && (i === 0 || results[i - 1].nearby) ? (
                  <li
                    aria-hidden
                    className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
                  >
                    Elsewhere in India
                  </li>
                ) : null}
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      onPick(r);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                      i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.label}</span>
                      {r.context ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.context}
                        </span>
                      ) : null}
                    </span>
                    {typeof r.distanceKm === "number" ? (
                      <span className="tnum shrink-0 text-[11px] text-muted-foreground">
                        {r.distanceKm < 1
                          ? `${Math.round(r.distanceKm * 1000)} m`
                          : `${Math.round(r.distanceKm)} km`}
                      </span>
                    ) : null}
                  </button>
                </li>
              </React.Fragment>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
