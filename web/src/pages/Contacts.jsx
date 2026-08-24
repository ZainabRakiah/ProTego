import * as React from "react";
import {
  Plus,
  MapPin,
  Trash2,
  Phone,
  Mail,
  Loader2,
  UserPlus,
  Users,
  Crosshair,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState, Separator, Skeleton } from "@/components/ui/misc";
import { PlaceSearch } from "@/components/PlaceSearch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION, useGeolocation } from "@/lib/geo";

export default function Contacts() {
  const { user } = useAuth();
  const { position } = useGeolocation({ watch: false });

  const [locations, setLocations] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [locOpen, setLocOpen] = React.useState(false);
  const [contactFor, setContactFor] = React.useState(null);

  const load = React.useCallback(async () => {
    if (!user?.id) return;
    try {
      setError(null);
      setLocations(await api.locationsWithContacts(user.id));
    } catch (err) {
      setError(err.message);
      setLocations([]);
    }
  }, [user?.id]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function removeLocation(id, label) {
    if (!confirm(`Delete "${label}" and all of its contacts?`)) return;
    try {
      await api.deleteLocation(id);
      toast.success("Place removed");
      load();
    } catch (err) {
      toast.error("Could not delete", { description: err.message });
    }
  }

  async function removeContact(id, name) {
    try {
      await api.deleteContact(id);
      toast.success(`${name} removed from your circle`);
      load();
    } catch (err) {
      toast.error("Could not delete", { description: err.message });
    }
  }

  const totalContacts =
    locations?.reduce((sum, l) => sum + (l.contacts?.length ?? 0), 0) ?? 0;

  return (
    <div className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trusted circle</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Save the places you travel between, and who should hear about each trip.
          </p>
        </div>
        <Button onClick={() => setLocOpen(true)}>
          <Plus className="size-4" />
          Add a place
        </Button>
      </header>

      {locations === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : locations.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No saved places yet"
          description="Add somewhere you travel to often — home, hostel, college — then attach the people who should be notified."
          action={
            <Button onClick={() => setLocOpen(true)}>
              <Plus className="size-4" />
              Add your first place
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" />
              {locations.length} {locations.length === 1 ? "place" : "places"}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {totalContacts} {totalContacts === 1 ? "contact" : "contacts"}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {locations.map((loc) => (
              <Card key={loc.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{loc.label}</CardTitle>
                    <CardDescription className="tnum mt-1">
                      {loc.lat != null && loc.lng != null
                        ? `${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)}`
                        : "No coordinates saved"}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${loc.label}`}
                    onClick={() => removeLocation(loc.id, loc.label)}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </CardHeader>

                <CardContent className="space-y-3">
                  <Separator />
                  {loc.contacts?.length ? (
                    <ul className="space-y-2">
                      {loc.contacts.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{c.name}</p>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {c.phone ? (
                                <a
                                  href={`tel:${c.phone}`}
                                  className="flex items-center gap-1 hover:text-foreground"
                                >
                                  <Phone className="size-3" />
                                  {c.phone}
                                </a>
                              ) : null}
                              {c.email ? (
                                <a
                                  href={`mailto:${c.email}`}
                                  className="flex items-center gap-1 truncate hover:text-foreground"
                                >
                                  <Mail className="size-3" />
                                  {c.email}
                                </a>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${c.name}`}
                            onClick={() => removeContact(c.id, c.name)}
                          >
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-1 text-sm text-muted-foreground">
                      No contacts attached to this place yet.
                    </p>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setContactFor(loc)}
                  >
                    <UserPlus className="size-3.5" />
                    Add contact
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <AddLocationDialog
        open={locOpen}
        onOpenChange={setLocOpen}
        userId={user?.id}
        position={position}
        onSaved={load}
      />
      <AddContactDialog
        location={contactFor}
        onOpenChange={(v) => !v && setContactFor(null)}
        onSaved={load}
      />
    </div>
  );
}

function AddLocationDialog({ open, onOpenChange, userId, position, onSaved }) {
  const [label, setLabel] = React.useState("");
  const [lat, setLat] = React.useState("");
  const [lng, setLng] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setLabel("");
      setLat("");
      setLng("");
      setSearch("");
    }
  }, [open]);

  function useHere() {
    const p = position ?? FALLBACK_POSITION;
    setLat(p.lat.toFixed(6));
    setLng(p.lng.toFixed(6));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addLocation({
        user_id: userId,
        label: label.trim(),
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
      });
      toast.success("Place saved");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error("Could not save", { description: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a place</DialogTitle>
          <DialogDescription>
            Give it a name you'll recognise in a hurry — Home, Hostel, College.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="loc-label">Name</Label>
            <Input
              id="loc-label"
              required
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Home"
            />
          </div>

          <PlaceSearch
            id="loc-search"
            label="Find it on the map"
            value={search}
            onChange={setSearch}
            onPick={(r) => {
              setSearch(r.label);
              setLat(r.lat.toFixed(6));
              setLng(r.lng.toFixed(6));
              if (!label.trim()) setLabel(r.label);
            }}
            placeholder="Search a place in India"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="loc-lat">Latitude</Label>
              <Input
                id="loc-lat"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="12.971600"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-lng">Longitude</Label>
              <Input
                id="loc-lng"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="77.594600"
              />
            </div>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={useHere}>
            <Crosshair className="size-3.5" />
            Use my current location
          </Button>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !label.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save place
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddContactDialog({ location, onOpenChange, onSaved }) {
  const [form, setForm] = React.useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = React.useState(false);
  const open = Boolean(location);

  React.useEffect(() => {
    if (open) setForm({ name: "", phone: "", email: "" });
  }, [open]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addContact({
        location_id: location.id,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      });
      toast.success(`${form.name.trim()} added to your circle`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error("Could not save", { description: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a trusted contact</DialogTitle>
          <DialogDescription>
            They'll be associated with {location?.label ?? "this place"}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Amma"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-phone">Phone</Label>
            <Input
              id="c-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+91 98765 43210"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-email">Email</Label>
            <Input
              id="c-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="amma@example.com"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Add contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
