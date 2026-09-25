import * as React from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }) {
  const [dark, setDark] = React.useState(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return (localStorage.getItem("protego.theme") ?? "dark") !== "light";
  });

  React.useEffect(() => {
    const checkTheme = () => {
      setDark(document.documentElement.classList.contains("dark"));
    };
    
    // Sync state on mount and window storage events
    checkTheme();
    window.addEventListener("storage", checkTheme);
    return () => window.removeEventListener("storage", checkTheme);
  }, []);

  const toggle = () => {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    localStorage.setItem("protego.theme", nextDark ? "dark" : "light");
    window.dispatchEvent(new Event("storage"));
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      className={cn("text-foreground hover:bg-accent/50 transition-colors", className)}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? (
        <Moon className="size-4.5 text-blue-300" />
      ) : (
        <Sun className="size-4.5 text-amber-500" />
      )}
    </Button>
  );
}
