import * as React from "react";
import { Loader2, Save, LogOut, Moon, Sun, Sparkles, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, Separator, Switch } from "@/components/ui/misc";
import { LogoutDialog } from "@/components/LogoutDialog";
import { OfflineCard } from "@/components/OfflineCard";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGeolocation } from "@/lib/geo";

const THEME_KEY = "protego.theme";

export default function Profile() {
  const { user, patchUser } = useAuth();
  const [logoutOpen, setLogoutOpen] = React.useState(false);
  const { position } = useGeolocation({ watch: false });

  const [form, setForm] = React.useState({
    name: user?.name ?? "",
    phone: user?.phone ?? "",
    address: user?.address ?? "",
  });
  const [busy, setBusy] = React.useState(false);
  const [dark, setDark] = React.useState(
    () => (localStorage.getItem(THEME_KEY) ?? "dark") === "dark",
  );
  const [animatedBg, setAnimatedBg] = React.useState(
    () => localStorage.getItem("protego.animatedBg") !== "0",
  );

  React.useEffect(() => {
    localStorage.setItem("protego.animatedBg", animatedBg ? "1" : "0");
    // The shell owns the backdrop, so tell it rather than lifting the state.
    window.dispatchEvent(new Event("protego:bg-changed"));
  }, [animatedBg]);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateProfile({
        user_id: user.id,
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      });
      patchUser({
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      });
      toast.success("Profile updated");
    } catch (err) {
      toast.error("Could not save", { description: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your details travel with every SOS and report you send.
        </p>
      </header>

      <Card>
        <CardHeader className="flex-row items-center gap-4 space-y-0">
          <Avatar name={user?.name} className="size-14 text-base" />
          <div className="min-w-0">
            <CardTitle className="truncate text-lg">{user?.name}</CardTitle>
            <CardDescription className="truncate">{user?.email}</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <Separator className="mb-5" />
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p-name">Full name</Label>
              <Input id="p-name" value={form.name} onChange={set("name")} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-phone">Phone</Label>
              <Input
                id="p-phone"
                type="tel"
                value={form.phone}
                onChange={set("phone")}
                placeholder="+91 98765 43210"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-address">Home address</Label>
              <Input
                id="p-address"
                value={form.address}
                onChange={set("address")}
                placeholder="Where should responders come to?"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-email">Email</Label>
              <Input id="p-email" value={user?.email ?? ""} disabled readOnly />
              <p className="text-xs text-muted-foreground">
                Your email is your login and cannot be changed here.
              </p>
            </div>

            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            ProTego is built for night use, so dark is the default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3.5 py-3">
              <Label htmlFor="theme" className="flex items-center gap-2.5">
                {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
                Dark mode
              </Label>
              <Switch id="theme" checked={dark} onCheckedChange={setDark} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3.5 py-3">
              <Label htmlFor="animated-bg" className="flex items-center gap-2.5">
                <Sparkles className="size-4" />
                <span>
                  Animated background
                  <span className="block text-xs font-normal text-muted-foreground">
                    Turn off to save battery
                  </span>
                </span>
              </Label>
              <Switch id="animated-bg" checked={animatedBg} onCheckedChange={setAnimatedBg} />
            </div>
          </div>
        </CardContent>
      </Card>

      <OfflineCard position={position} />

      <Card>
        <CardHeader>
          <CardTitle>Companion tools</CardTitle>
          <CardDescription>Other pieces of the ProTego project.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button asChild variant="outline" className="w-full justify-between">
            <a href="/friendsnavigator/" target="_blank" rel="noreferrer">
              FriendsNavigator — live location sharing
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground">
              Clears your session from this browser.
            </p>
          </div>
          <Button variant="outline" onClick={() => setLogoutOpen(true)}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>

      <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} />
    </div>
  );
}
