import * as React from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AccidentRescue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [location, setLocation] = React.useState(null);
  const [loadingLoc, setLoadingLoc] = React.useState(true);
  const [hospitals, setHospitals] = React.useState([]);
  const [loadingHospitals, setLoadingHospitals] = React.useState(false);
  const [alertHistory, setAlertHistory] = React.useState([]);
  
  // 10-second SOS countdown overlay state
  const [sosActive, setSosActive] = React.useState(false);
  const [countdown, setCountdown] = React.useState(10);
  const [sosSending, setSosSending] = React.useState(false);
  const timerRef = React.useRef(null);

  // Third-party accident state
  const [tpLat, setTpLat] = React.useState("");
  const [tpLng, setTpLng] = React.useState("");
  const [tpLabel, setTpLabel] = React.useState("");
  const [tpSending, setTpSending] = React.useState(false);

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
        toast.error("Unable to retrieve current location");
        setLoadingLoc(false);
        // Fallback default coordinates (e.g. Bangalore center)
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

  // Handle SOS 10s Countdown
  const startSosCountdown = () => {
    if (sosActive) return;
    setSosActive(true);
    setCountdown(10);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          triggerAccidentSos();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const cancelSosCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSosActive(false);
    setCountdown(10);
    toast.info("Accident SOS cancelled");
  };

  const triggerAccidentSos = async () => {
    setSosSending(true);
    try {
      const userId = user?.id || "guest";
      const lat = location?.lat || 12.9716;
      const lng = location?.lng || 77.5946;
      const res = await api.sosAccident(userId, lat, lng);
      setSosActive(false);
      toast.success("🚨 Accident SOS Dispatched! Top 3 Hospitals Alerted.", { duration: 6000 });
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

  // Handle Third-party accident report
  const handleThirdPartySubmit = async (e) => {
    e.preventDefault();
    const lat = parseFloat(tpLat || (location?.lat ? String(location.lat) : ""));
    const lng = parseFloat(tpLng || (location?.lng ? String(location.lng) : ""));
    if (!lat || !lng) {
      toast.error("Please provide valid latitude and longitude.");
      return;
    }
    setTpSending(true);
    try {
      const res = await api.accidentThirdParty(lat, lng, tpLabel || "Third-party report");
      toast.success("Accident reported! Top 3 nearest hospitals alerted for location.");
      setTpLabel("");
      setTpLat("");
      setTpLng("");
      await loadAlertHistory();
    } catch (err) {
      console.error("Third party accident error:", err);
      toast.error("Failed to send third-party accident alert.");
    } finally {
      setTpSending(false);
    }
  };

  const handleRouteToHospital = (h) => {
    const destParam = h.address
      ? `dest=${encodeURIComponent(h.address)}&destLat=${h.lat}&destLng=${h.lng}`
      : `destLat=${h.lat}&destLng=${h.lng}`;
    navigate(`/map?${destParam}`);
  };

  return (
    <div className="space-y-6">
      {/* 10-Second SOS Overlay Modal */}
      {sosActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in">
          <Card className="w-full max-w-md border-red-500/50 bg-card text-card-foreground shadow-2xl text-center">
            <CardHeader className="space-y-2">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-500/20 text-red-500 animate-pulse">
                <Ambulance className="size-10" />
              </div>
              <CardTitle className="text-2xl font-bold text-red-500">
                Accident SOS Countdown
              </CardTitle>
              <CardDescription>
                Top 3 nearest hospitals and emergency contacts will be dispatched in:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-6xl font-black tracking-tight text-primary">
                {countdown}s
              </div>
              <p className="text-xs text-muted-foreground">
                If this is a false alarm, press cancel immediately.
              </p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" size="lg" className="w-full" onClick={cancelSosCountdown}>
                  Cancel SOS
                </Button>
                <Button variant="destructive" size="lg" className="w-full font-bold" onClick={triggerAccidentSos} disabled={sosSending}>
                  {sosSending ? "Alerting..." : "Send Now"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-red-500/30 bg-gradient-to-r from-red-950/40 via-card to-card p-6 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-red-500/20 text-red-500">
              <Ambulance className="size-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Accident Rescue & Hospital Alerting</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Automatic 3-nearest hospital dispatch, hospital emergency alerts & crash assistance.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLocationAndHospitals} disabled={loadingLoc} className="self-start sm:self-auto gap-2">
          <RefreshCw className={`size-4 ${loadingLoc ? "animate-spin" : ""}`} />
          Refresh Location
        </Button>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SOS Emergency Dispatch Button Card */}
        <Card className="lg:col-span-1 border-red-500/40 bg-card/90 shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500 text-lg">
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
              className="group relative flex size-36 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-red-800 text-white font-extrabold text-2xl shadow-xl hover:scale-105 active:scale-95 transition-transform border-4 border-red-400/50"
            >
              <div className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
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
        <Card className="lg:col-span-2 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="size-5 text-primary" />
                3 Nearest Hospitals
              </CardTitle>
              <CardDescription>
                {location
                  ? `Located at ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
                  : "Fetching your GPS coordinates..."}
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-400">
              <Radio className="size-3 animate-pulse text-emerald-400" />
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
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border border-border bg-accent/20 hover:bg-accent/40 transition-colors"
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
                        <MapPin className="size-3 shrink-0" />
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
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          className="gap-1.5"
                        >
                          <a href={`tel:${h.phone}`}>
                            <PhoneCall className="size-3.5" />
                            Call
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleRouteToHospital(h)}
                        className="gap-1.5"
                      >
                        <Navigation className="size-3.5" />
                        Route
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tpLat">Latitude</Label>
                  <Input
                    id="tpLat"
                    type="number"
                    step="any"
                    placeholder={location ? String(location.lat) : "12.9716"}
                    value={tpLat}
                    onChange={(e) => setTpLat(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tpLng">Longitude</Label>
                  <Input
                    id="tpLng"
                    type="number"
                    step="any"
                    placeholder={location ? String(location.lng) : "77.5946"}
                    value={tpLng}
                    onChange={(e) => setTpLng(e.target.value)}
                  />
                </div>
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
    </div>
  );
}
