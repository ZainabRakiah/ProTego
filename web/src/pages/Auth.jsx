import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { MeshBackground } from "@/components/ui/background-shader";
import { MagneticCursor } from "@/components/ui/magnetic-cursor";
import { LogoMark } from "@/components/Logo";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFullscreenRoute } from "@/lib/useFullscreenRoute";
import { cn } from "@/lib/utils";

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
 * Sign in / register, centred over the animated wave field.
 *
 * The wave renders dark regardless of the app's light/dark setting, so this
 * screen opts out of the theme tokens and states its own light-on-dark palette.
 * Anything reading from --foreground here would be invisible in light mode.
 */
export default function Auth({ mode = "login" }) {
  useFullscreenRoute();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const isLogin = mode === "login";

  const [form, setForm] = React.useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [forgotOpen, setForgotOpen] = React.useState(false);

  const strength = strengthOf(form.password);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  React.useEffect(() => setError(null), [mode]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!isLogin && form.password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    setBusy(true);
    try {
      if (!isLogin) {
        await api.signup({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          password: form.password,
        });
      }
      // Registering signs straight in, so the flow never dead-ends on a form.
      const res = await api.login(form.email.trim(), form.password);
      signIn(res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <MagneticCursor magneticFactor={0.35} cursorSize={28} blendMode="exclusion">
      <div className="relative h-dvh w-full overflow-hidden">
      <MeshBackground />

      {/* Darkening veil: keeps text contrast steady as the gradient drifts. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,4,20,0.35)_0%,rgba(6,4,20,0.62)_65%,rgba(6,4,20,0.84)_100%)]"
      />

      <div className="relative z-10 h-full w-full overflow-y-auto overscroll-contain">
        <div className="animate-rise mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-5 px-5 py-6">
        {/* ---- Logo ---- */}
        <div className="flex flex-col items-center gap-2.5">
          {/* Swaps to web/public/logo.png automatically once that file exists. */}
          <LogoMark
            size={52}
            className="rounded-2xl shadow-[0_8px_32px_-8px_rgba(139,108,255,0.85)] ring-1 ring-white/25"
          />
          <div className="text-center">
            <p className="text-base font-semibold tracking-tight text-white">ProTego</p>
            <p className="text-[10px] tracking-[0.22em] text-white/55 uppercase">
              Night safety
            </p>
          </div>
        </div>

        {/* ---- Headline ---- */}
        <h1 className="max-w-md text-center text-2xl leading-[1.2] font-semibold tracking-tight text-balance text-white sm:text-[1.75rem]">
          Get home the way you'd want someone to watch you get home.
        </h1>

        {/* ---- Card ---- */}
        <div className="w-full rounded-2xl border border-white/15 bg-white/[0.07] p-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:p-6">
          {/* Mode switch */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/25 p-1">
            {[
              { id: "login", label: "Sign in", to: "/login" },
              { id: "signup", label: "Register", to: "/signup" },
            ].map((tab) => (
              <Link
                key={tab.id}
                to={tab.to}
                replace
                data-magnetic
                aria-current={mode === tab.id ? "page" : undefined}
                className={cn(
                  "rounded-lg px-4 py-2 text-center text-sm font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none",
                  mode === tab.id
                    ? "bg-white text-[#1a1230] shadow-sm"
                    : "text-white/65 hover:text-white",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
            {!isLogin ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-white/85">
                    Full name
                  </Label>
                  <Input
                    id="name"
                    required
                    autoComplete="name"
                    placeholder="Your name"
                    value={form.name}
                    onChange={set("name")}
                    className="border-white/15 bg-white/10 text-white placeholder:text-white/40 focus-visible:border-white/40 focus-visible:ring-white/25"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-white/85">
                    Phone <span className="font-normal text-white/45">(optional)</span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+91 98765…"
                    value={form.phone}
                    onChange={set("phone")}
                    className="border-white/15 bg-white/10 text-white placeholder:text-white/40 focus-visible:border-white/40 focus-visible:ring-white/25"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-white/85">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={set("email")}
                aria-invalid={Boolean(error)}
                className="border-white/15 bg-white/10 text-white placeholder:text-white/40 focus-visible:border-white/40 focus-visible:ring-white/25"
              />
            </div>


            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="password" className="text-white/85">
                  Password
                </Label>
                {isLogin ? (
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="rounded text-xs text-white/60 underline-offset-2 transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                  >
                    Forgot password?
                  </button>
                ) : null}
              </div>
              <PasswordInput
                id="password"
                required
                autoComplete={isLogin ? "current-password" : "new-password"}
                placeholder={isLogin ? "••••••••" : "At least 8 characters"}
                value={form.password}
                onChange={set("password")}
                aria-invalid={Boolean(error)}
                className="border-white/15 bg-white/10 text-white placeholder:text-white/40 focus-visible:border-white/40 focus-visible:ring-white/25"
                buttonClassName="text-white/50 hover:text-white focus-visible:ring-white/60"
              />

              {!isLogin && form.password ? (
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

            <Button
              type="submit"
              size="lg"
              disabled={busy}
              data-magnetic
              data-magnetic-color="rgba(255,255,255,0.9)"
              className="w-full bg-white text-[#1a1230] hover:bg-white/90"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy
                ? isLogin
                  ? "Signing in…"
                  : "Creating account…"
                : isLogin
                  ? "Sign in"
                  : "Create account"}
              {!busy && <ArrowRight className="size-4" />}
            </Button>
          </form>
        </div>

          <ForgotPasswordDialog
            open={forgotOpen}
            onOpenChange={setForgotOpen}
            defaultEmail={form.email}
            onDone={(resetEmail) => setForm((f) => ({ ...f, email: resetEmail, password: "" }))}
          />

          <p className="max-w-xs text-center text-[11px] leading-snug text-white/40">
            A prototype. In an emergency, call your local emergency number first.
          </p>
          </div>
        </div>
      </div>
    </MagneticCursor>
  );
}
