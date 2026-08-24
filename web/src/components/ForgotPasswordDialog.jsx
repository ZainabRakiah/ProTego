import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, X, KeyRound, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

const FIELD =
  "border-white/15 bg-white/10 text-white placeholder:text-white/40 " +
  "focus-visible:border-white/40 focus-visible:ring-white/25";

/** Cheap, honest strength signal — length plus character variety. */
function strengthOf(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(4, score);
}

const STRENGTH_LABEL = ["Too short", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = ["#f87171", "#f87171", "#fbbf24", "#4ade80", "#4ade80"];

/**
 * Two-step password reset, themed to match the sign-in screen.
 *
 * Step 1 proves ownership with the phone number on the account; step 2 spends
 * the short-lived token it returns. There is no mail provider in this project,
 * which is why identity is proved this way — see backend/app.py for what would
 * need to change before this is production-grade.
 */
export function ForgotPasswordDialog({ open, onOpenChange, defaultEmail = "", onDone }) {
  const [stage, setStage] = React.useState("verify"); // verify | choose | done
  const [email, setEmail] = React.useState(defaultEmail);
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [token, setToken] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const strength = strengthOf(password);

  React.useEffect(() => {
    if (!open) return;
    setStage("verify");
    setEmail(defaultEmail);
    setPhone("");
    setPassword("");
    setToken(null);
    setError(null);
    setBusy(false);
  }, [open, defaultEmail]);

  async function verify(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.forgotPassword(email.trim(), phone.trim());
      setToken(res.token);
      setStage("choose");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitNew(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setStage("done");
      onDone?.(email.trim());
    } catch (err) {
      setError(err.message);
      // An expired or spent token means starting over.
      if (/expired/i.test(err.message)) setStage("verify");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-sm" />
        <DialogPrimitive.Content className="animate-rise fixed top-1/2 left-1/2 z-[120] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/15 bg-[#120d24]/95 p-6 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-4 right-4 rounded-md p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>

          <div className="mb-5 flex flex-col items-center text-center">
            <span className="grid size-11 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
              {stage === "done" ? (
                <Check className="size-5 text-[#4ade80]" />
              ) : (
                <KeyRound className="size-5 text-white" />
              )}
            </span>
            <DialogPrimitive.Title className="mt-3 text-lg font-semibold tracking-tight text-white">
              {stage === "verify"
                ? "Reset your password"
                : stage === "choose"
                  ? "Choose a new password"
                  : "Password updated"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1.5 text-sm text-white/60">
              {stage === "verify"
                ? "Confirm the phone number on your account to continue."
                : stage === "choose"
                  ? "Pick something you haven't used here before."
                  : "You can sign in with your new password now."}
            </DialogPrimitive.Description>
          </div>

          {stage === "verify" ? (
            <form onSubmit={verify} className="space-y-3.5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="fp-email" className="text-white/85">
                  Email
                </Label>
                <Input
                  id="fp-email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={FIELD}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fp-phone" className="text-white/85">
                  Registered phone
                </Label>
                <Input
                  id="fp-phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className={FIELD}
                />
                <p className="text-xs text-white/40">
                  The number you signed up with. Spacing and +91 don't matter.
                </p>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-100"
                >
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-white text-[#1a1230] hover:bg-white/90"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy ? "Checking…" : "Continue"}
              </Button>
            </form>
          ) : stage === "choose" ? (
            <form onSubmit={submitNew} className="space-y-3.5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="fp-new" className="text-white/85">
                  New password
                </Label>
                <PasswordInput
                  id="fp-new"
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className={FIELD}
                  buttonClassName="text-white/50 hover:text-white focus-visible:ring-white/60"
                />
                {password ? (
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="flex flex-1 gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className="h-1 flex-1 rounded-full transition-colors"
                          style={{
                            background:
                              i < strength ? STRENGTH_COLOR[strength] : "rgba(255,255,255,0.18)",
                          }}
                        />
                      ))}
                    </div>
                    <span
                      className="w-16 text-right text-xs"
                      style={{ color: STRENGTH_COLOR[strength] }}
                    >
                      {STRENGTH_LABEL[strength]}
                    </span>
                  </div>
                ) : null}
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-100"
                >
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="border border-white/15 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => setStage("verify")}
                  disabled={busy}
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={busy}
                  className="flex-1 bg-white text-[#1a1230] hover:bg-white/90"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {busy ? "Saving…" : "Set password"}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              className="w-full bg-white text-[#1a1230] hover:bg-white/90"
              onClick={() => onOpenChange(false)}
            >
              Back to sign in
            </Button>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
