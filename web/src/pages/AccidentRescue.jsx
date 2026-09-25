import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import {
  Ambulance,
  PhoneCall,
  Navigation,
  AlertTriangle,
  ShieldAlert,
  Clock,
  MapPin,
  CheckCircle2,
  RefreshCw,
  UserCheck,
  Building2,
  Radio,
  LocateFixed,
  Map as MapIcon,
  X,
  Compass,
  Check,
  Route as RouteIcon,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Leaflet Map Custom Marker Icons
function createCustomPin(color = "#3b82f6", label = "") {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        background: ${color};
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 0 10px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 12px;
        font-weight: bold;
      ">${label}</div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const userPin = createCustomPin("#3b82f6", "YOU");
const hospitalPin = createCustomPin("#ef4444", "H");
const bystanderPin = createCustomPin("#f59e0b", "📍");

// Leaflet Map Helpers for Modals
function MapRefresher() {
  const map = useMap();
  React.useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function MapPinPickerHandler({ onSelectLocation }) {
  useMapEvents({
    click(e) {
      onSelectLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function AccidentRescue() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Primary user location
  const [location, setLocation] = React.useState(null);
  const [loadingLoc, setLoadingLoc] = React.useState(true);

  // Hospitals & Alert History
  const [hospitals, setHospitals] = React.useState([]);
  const [loadingHospitals, setLoadingHospitals] = React.useState(false);
  const [alertHistory, setAlertHistory] = React.useState([]);

  // SOS Countdown state
  const [sosActive, setSosActive] = React.useState(false);
  const [countdown, setCountdown] = React.useState(10);
  const [sosSending, setSosSending] = React.useState(false);

  // Bystander / Third-party accident state
  const [tpLabel, setTpLabel] = React.useState("");
  const [tpLocation, setTpLocation] = React.useState(null);
  const [tpSending, setTpSending] = React.useState(false);
  const [mapPickerOpen, setMapPickerOpen] = React.useState(false);
  const [tempPinLocation, setTempPinLocation] = React.useState(null);

  // In-Page Hospital Route Modal state
  const [selectedHospitalRoute, setSelectedHospitalRoute] = React.useState(null);
  const [loadingRoute, setLoadingRoute] = React.useState(false);

  const fetchLocationAndHospitals = React.useCallback(() => {
    setLoadingLoc(true);
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      setLoadingLoc(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(coords);
        setLoadingLoc(false);
        await loadHospitals(coords.lat, coords.lng);
      },
      (err) => {
        console.error("Location error:", err);
        toast.error("Unable to retrieve current GPS location. Using Bangalore default.");
        setLoadingLoc(false);
        const defaultCoords = { lat: 12.9716, lng: 77.5946 };
        setLocation(defaultCoords);
        loadHospitals(defaultCoords.lat, defaultCoords.lng);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const loadHospitals = async (lat, lng) => {
    setLoadingHospitals(true);
    try {
      const data = await api.hospitalsNearby(lat, lng);
      setHospitals((data?.hospitals || []).slice(0, 3));
    } catch (err) {
      console.error("Failed to fetch nearby hospitals:", err);
      toast.error("Failed to load nearby hospitals");
    } finally {
      setLoadingHospitals(false);
    }
  };

  const loadAlertHistory = async () => {
    try {
      const res = await api.getHospitalAlerts();
      if (res?.alerts) {
        setAlertHistory(res.alerts);
      }
    } catch (err) {
      console.error("Failed to load hospital alert history:", err);
    }
  };

  React.useEffect(() => {
    fetchLocationAndHospitals();
    loadAlertHistory();
  }, [fetchLocationAndHospitals]);

  // Clean Countdown logic (Fires EXACTLY ONCE when countdown hits 0)
  React.useEffect(() => {
    if (!sosActive) return;

    if (countdown <= 0) {
      setSosActive(false);
      triggerAccidentSos();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [sosActive, countdown]);

  const startSosCountdown = () => {
    if (sosActive || sosSending) return;
    setCountdown(10);
    setSosActive(true);
  };

  const cancelSosCountdown = () => {
    setSosActive(false);
    setCountdown(10);
    toast.info("Accident SOS cancelled");
  };

  const triggerAccidentSos = async () => {
    if (sosSending) return;
    setSosSending(true);
    try {
      const userId = user?.id || "guest";
      const lat = location?.lat || 12.9716;
      const lng = location?.lng || 77.5946;
      const res = await api.sosAccident(userId, lat, lng);

      toast.success("🚨 Accident SOS Dispatched! Top 3 Hospitals Alerted.", { id: "sos-dispatch-toast", duration: 5000 });
      if (res?.hospitals) {
        setHospitals(res.hospitals.slice(0, 3));
      }
      await loadAlertHistory();
    } catch (err) {
      console.error("Accident SOS Error:", err);
      toast.error("Failed to send Accident SOS. Please try again.");
    } finally {
      setSosSending(false);
    }
  };

  // Bystander / Third-party location helpers
  const handleFetchThirdPartyLiveLoc = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported");
      return;
    }
    toast.info("Fetching current GPS location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setTpLocation(coords);
        if (!tpLabel) setTpLabel("Live GPS Location");
        toast.success(`Location set: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
      },
      (err) => {
        console.error("GPS fetch error:", err);
        toast.error("Could not fetch GPS location");
      }
    );
  };

  const handleOpenMapPicker = () => {
    setTempPinLocation(tpLocation || location || { lat: 12.9716, lng: 77.5946 });
    setMapPickerOpen(true);
  };

  const handleConfirmMapPin = () => {
    if (!tempPinLocation) return;
    setTpLocation(tempPinLocation);
    if (!tpLabel) setTpLabel("Selected Spot on Map");
    setMapPickerOpen(false);
    toast.success(`Location pinned: ${tempPinLocation.lat.toFixed(4)}, ${tempPinLocation.lng.toFixed(4)}`);
  };

  const handleThirdPartySubmit = async (e) => {
    e.preventDefault();
    const coords = tpLocation || location || { lat: 12.9716, lng: 77.5946 };
    if (!coords?.lat || !coords?.lng) {
      toast.error("Please select or fetch a valid location first.");
      return;
    }
    setTpSending(true);
    try {
      const res = await api.accidentThirdParty(coords.lat, coords.lng, tpLabel || "Bystander Reported Accident");
      toast.success("Accident reported! Top 3 nearest hospitals alerted.");
      setTpLabel("");
      setTpLocation(null);
      await loadAlertHistory();
    } catch (err) {
      console.error("Third party accident error:", err);
      toast.error("Failed to send third-party accident alert.");
    } finally {
      setTpSending(false);
    }
  };

  // In-Page Hospital Fastest Route Handler (NO REDIRECTION)
  const handleRouteToHospitalInPage = async (h) => {
    const userPos = location || { lat: 12.9716, lng: 77.5946 };
    const hospPos = { lat: h.lat, lng: h.lng };
    setSelectedHospitalRoute({ hospital: h, route: null, loading: true });

    try {
      const routeRes = await api.safestRoute([userPos, hospPos], { mode: "drive" });
      setSelectedHospitalRoute({
        hospital: h,
        route: routeRes,
        userPos,
        hospPos,
        loading: false,
      });
    } catch (err) {
      console.error("Route calculation error:", err);
      // Fallback simple straight-line route if server routing is offline
      const fallbackRoute = {
        route: [[userPos.lat, userPos.lng], [hospPos.lat, hospPos.lng]],
        total_km: typeof h.distance_km === "number" ? h.distance_km : 3.5,
        total_min: typeof h.distance_km === "number" ? Math.round((h.distance_km / 40) * 60) : 8,
        instructions: [
          { text: "Proceed directly to " + h.name, distance: typeof h.distance_km === "number" ? h.distance_km * 1000 : 3500 },
        ],
      };
      setSelectedHospitalRoute({
        hospital: h,
        route: fallbackRoute,
        userPos,
        hospPos,
        loading: false,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* 10-Second SOS Overlay Modal */}
      {sosActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in">
          <Card className="w-full max-w-md border-red-500/50 bg-card/95 text-card-foreground shadow-2xl text-center p-6 space-y-6">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-500/20 text-red-500 animate-pulse">
              <Ambulance className="size-10" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-red-500">
                Accident SOS Countdown
              </h2>
              <p className="text-sm text-muted-foreground">
                Top 3 nearest hospitals and emergency contacts will be dispatched in:
              </p>
            </div>

            <div className="text-6xl font-black tracking-tight text-primary">
              {countdown}s
            </div>

            <p className="text-xs text-muted-foreground">
              If this is a false alarm, press cancel immediately.
            </p>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="w-full" onClick={cancelSosCountdown}>
                Cancel SOS
              </Button>
              <Button
                variant="destructive"
                size="lg"
                className="w-full font-bold bg-red-600 hover:bg-red-700"
                onClick={() => {
                  setSosActive(false);
                  triggerAccidentSos();
                }}
                disabled={sosSending}
              >
                {sosSending ? "Sending..." : "Send Now"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-border/70 bg-card p-5 sm:p-6 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive dark:bg-destructive/20">
              <Ambulance className="size-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Accident Rescue & Hospital Alerting</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Automatic 3-nearest hospital dispatch, hospital emergency alerts & crash assistance.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchLocationAndHospitals}
          disabled={loadingLoc}
          className="self-start sm:self-auto gap-2"
        >
          <RefreshCw className={`size-4 ${loadingLoc ? "animate-spin" : ""}`} />
          Refresh Location
        </Button>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SOS Emergency Dispatch Button Card */}
        <Card className="lg:col-span-1 border border-border/70 bg-card shadow-sm flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive text-lg">
              <ShieldAlert className="size-5" />
              Instant Accident SOS
            </CardTitle>
            <CardDescription>
              Triggers emergency hospital dispatch to the 3 nearest medical centers with your exact GPS location.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 flex-1 flex flex-col justify-center items-center text-center">
            <button
              onClick={startSosCountdown}
              disabled={sosActive || sosSending}
              className="group relative flex size-36 items-center justify-center rounded-full bg-gradient-to-br from-destructive to-red-700 text-white font-extrabold text-2xl shadow-xl hover:scale-105 active:scale-95 transition-transform border-4 border-red-400/30 cursor-pointer"
            >
              <div className="absolute inset-0 rounded-full bg-destructive/20 animate-ping" />
              <div className="relative flex flex-col items-center gap-1">
                <Radio className="size-8 animate-pulse" />
                <span>RESCUE</span>
              </div>
            </button>

            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">10-Second Countdown Protection</p>
              <p>Includes emergency hospital alert dispatch & SMS alert broadcast.</p>
            </div>
          </CardContent>
        </Card>

        {/* 3 Nearest Hospitals Section */}
        <Card className="lg:col-span-2 shadow-sm border border-border/70">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="size-5 text-primary" />
                3 Nearest Hospitals
              </CardTitle>
              <CardDescription>
                {location
                  ? `Based on coordinates: ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
                  : "Fetching your GPS coordinates..."}
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500 dark:text-emerald-400">
              <Radio className="size-3 animate-pulse text-emerald-500 dark:text-emerald-400" />
              Live Alert System
            </Badge>
          </CardHeader>
          <CardContent>
            {loadingHospitals ? (
              <div className="py-12 text-center text-muted-foreground space-y-2">
                <RefreshCw className="size-6 animate-spin mx-auto text-primary" />
                <p className="text-sm">Locating nearest hospitals...</p>
              </div>
            ) : hospitals.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No hospitals found within range.
              </div>
            ) : (
              <div className="space-y-3">
                {hospitals.map((h, i) => (
                  <div
                    key={h.id || i}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border border-border/60 bg-background/50 hover:bg-muted/40 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-xs">
                          #{i + 1}
                        </span>
                        <h3 className="font-semibold text-foreground text-sm sm:text-base">{h.name}</h3>
                        {h.alert_sent && (
                          <Badge variant="outline" className="bg-red-500/10 border-red-500/40 text-red-400 text-[10px]">
                            {h.status || "ALERTED"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="size-3 shrink-0 text-muted-foreground" />
                        {h.address || "Bangalore Emergency Medical Zone"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                        <span className="font-medium text-emerald-400">
                          {typeof h.distance_km === "number" ? `${h.distance_km.toFixed(1)} km away` : "Nearby"}
                        </span>
                        {h.phone && <span>📞 {h.phone}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-center">
                      {h.phone && (
                        <Button variant="outline" size="sm" asChild className="gap-1.5">
                          <a href={`tel:${h.phone}`}>
                            <PhoneCall className="size-3.5" />
                            Call
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleRouteToHospitalInPage(h)}
                        className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Navigation className="size-3.5" />
                        Fastest Route
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Third Party Accident Report & Dispatch Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Third Party Accident Report Card */}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck className="size-4 text-amber-500" />
              Report Accident for Someone Else
            </CardTitle>
            <CardDescription>
              Submit an emergency report for a bystander accident. Automatically dispatches alerts to the 3 nearest hospitals for that location.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleThirdPartySubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tpLabel">Location Landmark / Note</Label>
                <Input
                  id="tpLabel"
                  placeholder="e.g. MG Road Junction, near Metro station"
                  value={tpLabel}
                  onChange={(e) => setTpLabel(e.target.value)}
                />
              </div>

              {/* Location Selector Actions */}
              <div className="space-y-2">
                <Label>Accident Spot Selection</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFetchThirdPartyLiveLoc}
                    className="gap-1.5 flex-1"
                  >
                    <LocateFixed className="size-4 text-primary" />
                    Use Live GPS Location
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenMapPicker}
                    className="gap-1.5 flex-1"
                  >
                    <MapIcon className="size-4 text-amber-400" />
                    Drop Pin on Map
                  </Button>
                </div>

                {tpLocation ? (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs">
                    <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                      <MapPin className="size-4 text-emerald-400" />
                      Pinned Spot: {tpLocation.lat.toFixed(4)}, {tpLocation.lng.toFixed(4)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setTpLocation(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : location ? (
                  <p className="text-xs text-muted-foreground">
                    Current Location: GPS ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})
                  </p>
                ) : null}
              </div>

              <Button type="submit" variant="secondary" className="w-full gap-2 font-semibold" disabled={tpSending}>
                <AlertTriangle className="size-4 text-amber-500" />
                {tpSending ? "Alerting Hospitals..." : "Report & Alert Hospitals"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Hospital Alert History Card */}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              Hospital Dispatch Audit Log
            </CardTitle>
            <CardDescription>
              Live record of emergency hospital alerts dispatched by the ProTego Rescue system.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {alertHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No hospital dispatch history logged yet.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {alertHistory.slice(0, 10).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-accent/10 text-xs">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-foreground">
                        {item.hospital_name || "Emergency Hospital Alert"}
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        {item.location_label || `Lat: ${item.lat}, Lng: ${item.lng}`}
                      </p>
                    </div>
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                      <CheckCircle2 className="size-3 mr-1" />
                      {item.status || "DISPATCHED"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ----------------- IN-PAGE MAP PIN PICKER MODAL ----------------- */}
      <Dialog open={mapPickerOpen} onOpenChange={setMapPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <MapPin className="size-5" />
              Drop Emergency Pin on Map
            </DialogTitle>
            <DialogDescription>
              Click anywhere on the map below to set the exact accident location.
            </DialogDescription>
          </DialogHeader>

          <div className="relative h-80 w-full overflow-hidden rounded-xl border border-border">
            {mapPickerOpen && tempPinLocation && (
              <MapContainer
                center={[tempPinLocation.lat, tempPinLocation.lng]}
                zoom={14}
                className="h-full w-full"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapRefresher />
                <MapPinPickerHandler onSelectLocation={setTempPinLocation} />
                <Marker position={[tempPinLocation.lat, tempPinLocation.lng]} icon={bystanderPin}>
                  <Popup>Accident Spot</Popup>
                </Marker>
              </MapContainer>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs font-mono text-muted-foreground">
              📍 Pin: {tempPinLocation?.lat.toFixed(5)}, {tempPinLocation?.lng.toFixed(5)}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setMapPickerOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirmMapPin} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold">
                <Check className="size-4" />
                Confirm Location Pin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ----------------- IN-PAGE FASTEST HOSPITAL ROUTE MODAL ----------------- */}
      <Dialog open={Boolean(selectedHospitalRoute)} onOpenChange={(v) => !v && setSelectedHospitalRoute(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <Ambulance className="size-5 text-red-500" />
              Fastest Route: {selectedHospitalRoute?.hospital?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedHospitalRoute?.hospital?.address || "Emergency Navigation Guidance"}
            </DialogDescription>
          </DialogHeader>

          {selectedHospitalRoute?.loading ? (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="size-8 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">Calculating fastest emergency route...</p>
            </div>
          ) : selectedHospitalRoute?.route ? (
            <div className="space-y-4">
              {/* Route Summary Stats Bar */}
              <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-accent/30 border border-border text-center text-xs">
                <div>
                  <p className="text-muted-foreground">Travel Distance</p>
                  <p className="text-base font-bold text-foreground">
                    {selectedHospitalRoute.route.total_km ? `${selectedHospitalRoute.route.total_km.toFixed(1)} km` : "--"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Estimated Time (ETA)</p>
                  <p className="text-base font-bold text-emerald-400">
                    {selectedHospitalRoute.route.total_min ? `${Math.round(selectedHospitalRoute.route.total_min)} mins` : "--"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Route Mode</p>
                  <Badge variant="outline" className="mt-0.5 bg-blue-500/10 text-blue-400 border-blue-500/30">
                    Fastest Driving
                  </Badge>
                </div>
              </div>

              {/* In-Page Route Map Container */}
              <div className="relative h-72 w-full overflow-hidden rounded-xl border border-border">
                <MapContainer
                  center={[selectedHospitalRoute.userPos.lat, selectedHospitalRoute.userPos.lng]}
                  zoom={13}
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapRefresher />
                  {/* Start Marker */}
                  <Marker position={[selectedHospitalRoute.userPos.lat, selectedHospitalRoute.userPos.lng]} icon={userPin}>
                    <Popup>Your Location</Popup>
                  </Marker>
                  {/* Destination Hospital Marker */}
                  <Marker position={[selectedHospitalRoute.hospPos.lat, selectedHospitalRoute.hospPos.lng]} icon={hospitalPin}>
                    <Popup>{selectedHospitalRoute.hospital.name}</Popup>
                  </Marker>
                  {/* Route Polyline */}
                  {selectedHospitalRoute.route.route && (
                    <Polyline
                      positions={
                        Array.isArray(selectedHospitalRoute.route.route[0])
                          ? selectedHospitalRoute.route.route
                          : selectedHospitalRoute.route.route.map((pt) => [pt.lat, pt.lng])
                      }
                      pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.9 }}
                    />
                  )}
                </MapContainer>
              </div>

              {/* Turn-by-Turn Maneuvers List */}
              {selectedHospitalRoute.route.instructions && selectedHospitalRoute.route.instructions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Compass className="size-3.5 text-primary" />
                    Turn-by-Turn Emergency Directions
                  </h4>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {selectedHospitalRoute.route.instructions.map((inst, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded bg-card/60 border border-border text-xs">
                        <RouteIcon className="size-3.5 shrink-0 text-primary" />
                        <span className="flex-1 truncate">{inst.text || inst.instruction || "Proceed straight"}</span>
                        {inst.distance && (
                          <span className="text-muted-foreground text-[10px]">
                            {inst.distance > 1000 ? `${(inst.distance / 1000).toFixed(1)}km` : `${Math.round(inst.distance)}m`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer Modal Actions */}
              <div className="flex items-center justify-between pt-2">
                {selectedHospitalRoute.hospital.phone ? (
                  <Button variant="outline" size="sm" asChild className="gap-1.5">
                    <a href={`tel:${selectedHospitalRoute.hospital.phone}`}>
                      <PhoneCall className="size-4 text-emerald-400" />
                      Call Emergency Desk ({selectedHospitalRoute.hospital.phone})
                    </a>
                  </Button>
                ) : <div />}
                <Button variant="secondary" size="sm" onClick={() => setSelectedHospitalRoute(null)}>
                  Close Navigation
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
