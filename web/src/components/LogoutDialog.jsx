import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { LogOut, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/Logo";
import { useAuth } from "@/lib/auth";

/**
 * Confirm-before-signing-out sheet, themed to match the auth screen.
 *
 * Signing out drops the session and any unsaved page state, so it asks first
 * rather than acting on a single stray click. It carries the sign-in screen's
 * palette so it reads as part of the same flow the user is about to land in.
 */
export function LogoutDialog({ open, onOpenChange }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  function confirm() {
    setBusy(true);
    // A beat of feedback so the sign-out reads as an action, not a page blink.
    setTimeout(() => {
      signOut();
      onOpenChange(false);
      navigate("/login", { replace: true });
    }, 550);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="animate-rise fixed top-1/2 left-1/2 z-[120] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/15 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.9)]"
          aria-describedby="logout-desc"
        >
          {/*
            The sign-in screen's mesh palette as a static gradient. This dialog
            is small and shown for a moment, so it is not worth pulling the
            WebGL shader (and its ~40KB) into the main bundle to animate it.
          */}
          <div className="absolute inset-0 -z-10 overflow-hidden bg-[#0a0718]">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(140deg, hsl(258 72% 22%), hsl(250 68% 34%) 40%, hsl(266 74% 52%) 72%, hsl(216 70% 44%))",
              }}
            />
            <div aria-hidden className="absolute inset-0 bg-black/55" />
          </div>

          <div className="p-6 sm:p-7">
            <DialogPrimitive.Close
              aria-label="Cancel"
              className="absolute top-4 right-4 rounded-md p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>

            <div className="flex flex-col items-center text-center">
              <LogoMark size={52} className="rounded-xl ring-1 ring-white/25" />

              <DialogPrimitive.Title className="mt-4 text-xl font-semibold tracking-tight text-white">
                {busy ? "Signing you out…" : "Sign out of ProTego?"}
              </DialogPrimitive.Title>

              <p id="logout-desc" className="mt-2 text-sm text-white/65">
                {busy ? (
                  "See you soon. Stay safe out there."
                ) : (
                  <>
                    You'll be signed out
                    {user?.name ? (
                      <>
                        {" "}
                        of <span className="font-medium text-white/85">{user.name}</span>
                      </>
                    ) : null}{" "}
                    on this device. Your saved places, contacts and evidence stay
                    on your account.
                  </>
                )}
              </p>
            </div>

            <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="ghost"
                className="flex-1 border border-white/15 text-white hover:bg-white/10 hover:text-white"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Stay signed in
              </Button>
              <Button
                className="flex-1 bg-white text-[#1a1230] hover:bg-white/90"
                onClick={confirm}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
                {busy ? "Signing out" : "Sign out"}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
