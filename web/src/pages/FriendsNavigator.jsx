import * as React from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import {
  Compass,
  Users,
  Plus,
  Target,
  Crosshair,
  Navigation,
  Share2,
  Trash2,
  LogOut,
  MapPin,
  Clock,
  Ruler,
  UserPlus,
  Loader2,
  Check,
  ChevronRight,
  Route,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState, Separator, Avatar } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION, useGeolocation } from "@/lib/geo";
import { DEFAULT_LAYER_ID, getLayer } from "@/lib/mapLayers";
import { cn, formatDistance } from "@/lib/utils";

const FIREBASE_DB_URL = "https://loc-live-track-default-rtdb.firebaseio.com";
const OSRM_API = "https://router.project-osrm.org/route/v1/driving";

/** Custom leaflet marker pin helper */
function createMarkerIcon(label, isMe = false, isMeetup = false, colorOverride = null) {
  const bg = isMeetup
    ? "oklch(0.68 0.19 25)"
    : isMe
    ? "var(--primary)"
    : colorOverride || "#8A9DB1";
  
  const text = isMeetup ? "🎯" : label;

  return L.divIcon({
    className: "",
    html: `<span style="
      display:grid;place-items:center;padding:0 6px;height:30px;min-width:30px;border-radius:999px;
      background:${bg};color:#fff;font:600 12px/1 ui-sans-serif,system-ui;
      box-shadow:0 0 0 3px color-mix(in oklab, ${bg} 30%, transparent), 0 4px 12px rgba(0,0,0,.45);
      white-space:nowrap;
    ">${text}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function RecenterMap({ position, trigger }) {
  const map = useMap();
  React.useEffect(() => {
    if (position && trigger) {
      map.flyTo([position.lat, position.lng], 15, { duration: 0.8 });
    }
  }, [trigger, position, map]);
  return null;
}

function MapClickListener({ onMapClick, active }) {
  const map = useMap();
  React.useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      onMapClick(e.latlng);
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [active, onMapClick, map]);
  return null;
}

export default function FriendsNavigator() {
  const { user } = useAuth();
  const { position: geoPos } = useGeolocation({ watch: true });
  const here = geoPos ?? FALLBACK_POSITION;

  // Local storage for persistent user ID & display name
  const [uid] = React.useState(() => {
    let stored = localStorage.getItem("fn_uid");
    if (!stored) {
      stored = "u_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("fn_uid", stored);
    }
    return stored;
  });

  const [displayName, setDisplayName] = React.useState(() => {
    return user?.name || localStorage.getItem("fn_name") || "Explorer";
  });

  // Teams state
  const [teamId, setTeamId] = React.useState(null);
  const [teamName, setTeamName] = React.useState("");
  const [recentTeams, setRecentTeams] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem("fn_recent_teams") || "[]");
    } catch {
      return [];
    }
  });

  // Real-time team state
  const [members, setMembers] = React.useState({});
  const [waypoints, setWaypoints] = React.useState([]);
  const [meetup, setMeetup] = React.useState(null);

  // Map controls
  const [recenterTick, setRecenterTick] = React.useState(0);
  const [waypointDropMode, setWaypointDropMode] = React.useState(false);
  const [routes, setRoutes] = React.useState([]);
  const [selectedWaypoint, setSelectedWaypoint] = React.useState(null);
  const [routeInfo, setRouteInfo] = React.useState(null);

  // Dialog states
  const [createOpen, setCreateOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [newTeamInput, setNewTeamInput] = React.useState("");
  const [nameInput, setNameInput] = React.useState(displayName);

  const layer = getLayer(DEFAULT_LAYER_ID);

  // Save recent teams
  const addRecentTeam = React.useCallback((id, name) => {
    setRecentTeams((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      const next = [{ id, name: name || id, time: Date.now() }, ...filtered].slice(0, 5);
      localStorage.setItem("fn_recent_teams", JSON.stringify(next));
      return next;
    });
  }, []);

  // Update display name
  const updateDisplayName = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    localStorage.setItem("fn_name", trimmed);
  };

  // Broadcast live location to Firebase REST endpoint
  React.useEffect(() => {
    if (!teamId || !geoPos) return;

    const pushLocation = async () => {
      try {
        await fetch(`${FIREBASE_DB_URL}/teams/${teamId}/members/${uid}.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: uid,
            name: displayName,
            lat: geoPos.lat,
            lng: geoPos.lng,
            ts: Date.now(),
          }),
        });
      } catch (e) {
        // Fallback silently if offline
      }
    };

    pushLocation();
    const interval = setInterval(pushLocation, 4000);
    return () => clearInterval(interval);
  }, [teamId, uid, displayName, geoPos]);

  // Poll Firebase RTDB for current team updates
  React.useEffect(() => {
    if (!teamId) return;

    let cancelled = false;
    const pollTeam = async () => {
      try {
        const res = await fetch(`${FIREBASE_DB_URL}/teams/${teamId}.json`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data) return;

        setMembers(data.members || {});
        
        if (data.waypoints) {
          const wpList = Object.values(data.waypoints).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          setWaypoints(wpList);
        } else {
          setWaypoints([]);
        }

        setMeetup(data.meetup || null);
        if (data.name) setTeamName(data.name);
      } catch (e) {
        // Silent fallback
      }
    };

    pollTeam();
    const id = setInterval(pollTeam, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [teamId]);

  // Handle Team Creation
  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!newTeamInput.trim()) return;

    const tName = newTeamInput.trim();
    const tId = tName.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.floor(1000 + Math.random() * 9000);
    updateDisplayName(nameInput);

    try {
      await fetch(`${FIREBASE_DB_URL}/teams/${tId}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: tId,
          name: tName,
          createdAt: Date.now(),
          members: {
            [uid]: {
              id: uid,
              name: nameInput.trim() || displayName,
              lat: here.lat,
              lng: here.lng,
              ts: Date.now(),
            },
          },
        }),
      });

      setTeamId(tId);
      setTeamName(tName);
      addRecentTeam(tId, tName);
      setCreateOpen(false);
      setNewTeamInput("");
      toast.success(`Team "${tName}" created!`, { description: `Team Code: ${tId}` });
    } catch (err) {
      toast.error("Could not create team", { description: err.message });
    }
  };

  // Handle Joining Team
  const handleJoinTeam = async (e) => {
    e.preventDefault();
    if (!newTeamInput.trim()) return;

    const rawInput = newTeamInput.trim();
    const tId = rawInput.toLowerCase().replace(/[^a-z0-9-]/g, "");
    updateDisplayName(nameInput);

    try {
      const res = await fetch(`${FIREBASE_DB_URL}/teams/${tId}.json`);
      const data = await res.json();

      const name = data?.name || rawInput;

      await fetch(`${FIREBASE_DB_URL}/teams/${tId}/members/${uid}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: uid,
          name: nameInput.trim() || displayName,
          lat: here.lat,
          lng: here.lng,
          ts: Date.now(),
        }),
      });

      setTeamId(tId);
      setTeamName(name);
      addRecentTeam(tId, name);
      setJoinOpen(false);
      setNewTeamInput("");
      toast.success(`Joined team "${name}"`);
    } catch (err) {
      toast.error("Could not join team", { description: err.message });
    }
  };

  const handleLeaveTeam = () => {
    if (!confirm("Leave this team session?")) return;
    if (teamId && uid) {
      fetch(`${FIREBASE_DB_URL}/teams/${teamId}/members/${uid}.json`, { method: "DELETE" }).catch(() => {});
    }
    setTeamId(null);
    setMembers({});
    setWaypoints([]);
    setMeetup(null);
    setRoutes([]);
    setRouteInfo(null);
    toast.info("Left the team session");
  };

  const copyTeamCode = () => {
    if (!teamId) return;
    navigator.clipboard.writeText(teamId);
    toast.success("Team code copied to clipboard!", { description: teamId });
  };

  // Add Waypoint
  const handleMapClick = async (latlng) => {
    if (!teamId || !waypointDropMode) return;

    if (waypoints.length >= 5) {
      toast.warning("Waypoint limit reached", { description: "Max 5 waypoints allowed per adventure." });
      setWaypointDropMode(false);
      return;
    }

    const title = prompt("Enter waypoint or destination name:", `Stop ${waypoints.length + 1}`);
    if (!title || !title.trim()) return;

    const wpId = "wp_" + Date.now();
    const newWp = {
      id: wpId,
      name: title.trim(),
      lat: latlng.lat,
      lng: latlng.lng,
      createdAt: Date.now(),
    };

    try {
      await fetch(`${FIREBASE_DB_URL}/teams/${teamId}/waypoints/${wpId}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newWp),
      });

      setWaypoints((prev) => [...prev, newWp]);
      setWaypointDropMode(false);
      toast.success(`Waypoint "${title.trim()}" added!`);
    } catch (err) {
      toast.error("Could not save waypoint");
    }
  };

  const handleSetMeetup = async (wp) => {
    if (!teamId) return;
    try {
      const meetupData = {
        waypointId: wp.id,
        name: wp.name,
        lat: wp.lat,
        lng: wp.lng,
        updatedAt: Date.now(),
      };
      await fetch(`${FIREBASE_DB_URL}/teams/${teamId}/meetup.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meetupData),
      });
      setMeetup(meetupData);
      toast.success(`Set "${wp.name}" as the team Meetup target! 🎯`);
    } catch (e) {
      toast.error("Failed to set meetup point");
    }
  };

  const handleDeleteWaypoint = async (wpId) => {
    if (!teamId) return;
    try {
      await fetch(`${FIREBASE_DB_URL}/teams/${teamId}/waypoints/${wpId}.json`, { method: "DELETE" });
      setWaypoints((prev) => prev.filter((w) => w.id !== wpId));
      if (meetup?.waypointId === wpId) {
        fetch(`${FIREBASE_DB_URL}/teams/${teamId}/meetup.json`, { method: "DELETE" });
        setMeetup(null);
      }
      toast.success("Waypoint removed");
    } catch (e) {
      toast.error("Failed to remove waypoint");
    }
  };

  // Compute directions & OSRM route to a target
  const handleShowDirections = async (targetLat, targetLng, targetName) => {
    const memberList = Object.values(members);
    if (!memberList.length) {
      toast.error("No active members in team");
      return;
    }

    toast.info(`Calculating routes to ${targetName}...`);
    const newRoutes = [];
    const colors = ["#8A9DB1", "#ECC5C6", "#5289AD", "#ACBCBF", "#837D68"];
    let colorIdx = 0;

    for (const member of memberList) {
      if (!member.lat || !member.lng) continue;
      const url = `${OSRM_API}/${member.lng},${member.lat};${targetLng},${targetLat}?overview=full&geometries=geojson`;

      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.code === "Ok" && data.routes?.length) {
          const route = data.routes[0];
          const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
          const isMe = member.id === uid;

          newRoutes.push({
            memberId: member.id,
            memberName: isMe ? "You" : member.name || "Friend",
            coords,
            distance: (route.distance / 1000).toFixed(1),
            duration: Math.round(route.duration / 60),
            color: isMe ? "var(--primary)" : colors[colorIdx++ % colors.length],
          });
        }
      } catch (e) {
        // Continue loop
      }
    }

    setRoutes(newRoutes);
    if (newRoutes.length > 0) {
      const myRoute = newRoutes.find((r) => r.memberId === uid) || newRoutes[0];
      setRouteInfo({
        destination: targetName,
        distance: myRoute.distance,
        duration: myRoute.duration,
      });
      toast.success(`Routes drawn to ${targetName}!`);
    } else {
      toast.error("Could not calculate route");
    }
  };

  return (
    <div className="animate-rise space-y-4 sm:space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl flex items-center gap-2.5">
            <Compass className="size-7 text-primary" />
            Friends navigator
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time live location sharing & adventure route planning for your group.
          </p>
        </div>

        {teamId ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyTeamCode}>
              <Share2 className="size-4" />
              Code: <span className="font-mono font-bold">{teamId}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLeaveTeam} className="text-destructive hover:bg-destructive/10">
              <LogOut className="size-4" />
              Leave Team
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setNameInput(displayName); setJoinOpen(true); }}>
              <Users className="size-4" />
              Join Team
            </Button>
            <Button onClick={() => { setNameInput(displayName); setCreateOpen(true); }}>
              <Plus className="size-4" />
              Create Team
            </Button>
          </div>
        )}
      </header>

      {/* Main View Area */}
      {!teamId ? (
        <div className="grid gap-5 md:grid-cols-2">
          {/* Welcome / Join Card */}
          <Card className="surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-primary" />
                Start a group session
              </CardTitle>
              <CardDescription>
                Share your live position with trusted friends during night trips or outdoor adventures.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Button className="flex-1" onClick={() => { setNameInput(displayName); setCreateOpen(true); }}>
                  <Plus className="size-4" />
                  Create New Team
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => { setNameInput(displayName); setJoinOpen(true); }}>
                  <Users className="size-4" />
                  Join Team
                </Button>
              </div>

              <Separator />

              <div>
                <Label htmlFor="display-name" className="text-xs">Your Display Name in Teams</Label>
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={(e) => updateDisplayName(e.target.value)}
                  placeholder="Your Name"
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          {/* Recent Teams Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent teams</CardTitle>
              <CardDescription>Jump back into your recently active team sessions.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentTeams.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No recent teams saved yet. Create or join one to get started!
                </p>
              ) : (
                <ul className="space-y-2">
                  {recentTeams.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2.5 transition-colors hover:bg-accent/40 cursor-pointer"
                      onClick={() => {
                        setTeamId(t.id);
                        setTeamName(t.name);
                        toast.success(`Reconnected to ${t.name}`);
                      }}
                    >
                      <div>
                        <p className="text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{t.id}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="gap-1 text-xs">
                        Join <ChevronRight className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(320px,360px)_1fr] lg:gap-5">
          {/* Side Control Panel */}
          <div className="space-y-4">
            {/* Team Info Card */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {teamName}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs mt-0.5">
                    ID: {teamId}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="gap-1">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </Badge>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Active Members List */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Team Members</span>
                    <span>{Object.keys(members).length} active</span>
                  </p>
                  <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {Object.values(members).map((m) => {
                      const isMe = m.id === uid;
                      return (
                        <li
                          key={m.id}
                          className={cn(
                            "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
                            isMe ? "border-primary/50 bg-primary/10 font-medium" : "border-border/60 bg-background/30"
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <Avatar name={m.name || "User"} className="size-7 text-xs" />
                            <span className="truncate">{m.name || "User"} {isMe ? "(You)" : ""}</span>
                          </div>
                          <span className="size-2 rounded-full bg-emerald-500" title="Online" />
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <Separator />

                {/* Adventure Waypoints Section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Start Adventure Waypoints
                    </p>
                    <Button
                      variant={waypointDropMode ? "default" : "outline"}
                      size="sm"
                      onClick={() => setWaypointDropMode(!waypointDropMode)}
                      className="h-7 text-xs gap-1"
                    >
                      <MapPin className="size-3.5" />
                      {waypointDropMode ? "Click Map Pin" : "+ Add Pin"}
                    </Button>
                  </div>

                  {waypoints.length === 0 ? (
                    <p className="py-2 text-xs text-muted-foreground text-center">
                      No waypoints added yet. Tap "+ Add Pin" then click the map!
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {waypoints.map((wp, idx) => {
                        const isMeet = meetup?.waypointId === wp.id;
                        return (
                          <li
                            key={wp.id}
                            className={cn(
                              "flex flex-col gap-2 rounded-lg border p-2.5 text-xs transition-colors",
                              isMeet ? "border-red-500/50 bg-red-500/10" : "border-border/60 bg-background/30"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold flex items-center gap-1.5 truncate">
                                📍 {idx + 1}. {wp.name}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title="Remove"
                                  onClick={() => handleDeleteWaypoint(wp.id)}
                                >
                                  <Trash2 className="size-3.5 text-muted-foreground" />
                                </Button>
                              </div>
                            </div>

                            <div className="flex gap-1.5 mt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 h-7 text-[11px]"
                                onClick={() => handleSetMeetup(wp)}
                              >
                                <Target className="size-3 text-red-500" />
                                Meet Here
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="flex-1 h-7 text-[11px]"
                                onClick={() => handleShowDirections(wp.lat, wp.lng, wp.name)}
                              >
                                <Navigation className="size-3" />
                                Directions
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Directions Card if Active */}
            {routeInfo && (
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Route className="size-4 text-primary" />
                    {routeInfo.destination}
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => { setRoutes([]); setRouteInfo(null); }}>
                    Clear
                  </Button>
                </CardHeader>
                <CardContent className="py-2 px-4 flex justify-between text-xs">
                  <span>Distance: <strong>{routeInfo.distance} km</strong></span>
                  <span>ETA: <strong>{routeInfo.duration} mins</strong></span>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Live Map Area */}
          <Card className="overflow-hidden p-0">
            <div className="relative h-[60vh] min-h-[400px] lg:h-[calc(100dvh-11rem)]">
              <MapContainer
                center={[here.lat, here.lng]}
                zoom={14}
                scrollWheelZoom
                className={cn("size-full", layer.invertInDark && "map-invert")}
              >
                <TileLayer
                  key={layer.id}
                  attribution={layer.attribution}
                  url={layer.url}
                  maxZoom={layer.maxZoom}
                />

                <RecenterMap position={here} trigger={recenterTick} />
                <MapClickListener onMapClick={handleMapClick} active={waypointDropMode} />

                {/* Team Member Markers */}
                {Object.values(members).map((m) => {
                  if (!m.lat || !m.lng) return null;
                  const isMe = m.id === uid;
                  const icon = createMarkerIcon(isMe ? "YOU" : (m.name?.charAt(0) || "U"), isMe);

                  return (
                    <Marker key={m.id} position={[m.lat, m.lng]} icon={icon}>
                      <Popup>
                        <strong>{m.name || "User"} {isMe ? "(You)" : ""}</strong>
                        <div className="text-xs text-muted-foreground mt-0.5">Live sharing active</div>
                      </Popup>
                    </Marker>
                  );
                })}

                {/* Waypoint Markers */}
                {waypoints.map((wp) => {
                  const isMeet = meetup?.waypointId === wp.id;
                  const icon = createMarkerIcon(wp.name, false, isMeet);

                  return (
                    <Marker key={wp.id} position={[wp.lat, wp.lng]} icon={icon}>
                      <Popup>
                        <strong>📍 {wp.name}</strong>
                        {isMeet && <div className="text-xs text-red-500 font-bold mt-1">🎯 TARGET MEETUP POINT</div>}
                        <div className="mt-2 flex gap-1">
                          <button
                            className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded"
                            onClick={() => handleShowDirections(wp.lat, wp.lng, wp.name)}
                          >
                            Route Here
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {/* Route Polylines */}
                {routes.map((r, i) => (
                  <Polyline
                    key={i}
                    positions={r.coords}
                    pathOptions={{ color: r.color, weight: 5, opacity: 0.85 }}
                  />
                ))}
              </MapContainer>

              {/* Floating Action Overlay */}
              <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[500] flex items-end justify-between">
                {waypointDropMode ? (
                  <Badge variant="default" className="pointer-events-auto shadow-lg bg-amber-500 text-black px-3 py-1.5 text-xs font-semibold animate-pulse">
                    📍 Tap anywhere on map to drop waypoint
                  </Badge>
                ) : (
                  <div className="pointer-events-auto flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shadow-lg surface"
                      onClick={() => setRecenterTick((t) => t + 1)}
                    >
                      <Crosshair className="size-4" />
                      Find Me
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Dialog: Create Team */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a Friends Navigator Team</DialogTitle>
            <DialogDescription>
              Name your group trip. Friends can join using your team code!
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateTeam} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-create-name">Team Name</Label>
              <Input
                id="team-create-name"
                required
                autoFocus
                value={newTeamInput}
                onChange={(e) => setNewTeamInput(e.target.value)}
                placeholder="Night Riders, Weekend Trip, etc."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-display-name">Your Display Name</Label>
              <Input
                id="user-display-name"
                required
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your Name"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newTeamInput.trim()}>
                Create Team
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Join Team */}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join a Friends Navigator Team</DialogTitle>
            <DialogDescription>
              Enter the team code or name shared by your friend.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleJoinTeam} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-join-id">Team Code or Name</Label>
              <Input
                id="team-join-id"
                required
                autoFocus
                value={newTeamInput}
                onChange={(e) => setNewTeamInput(e.target.value)}
                placeholder="e.g. night-riders-4812"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-join-name">Your Display Name</Label>
              <Input
                id="user-join-name"
                required
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your Name"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setJoinOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newTeamInput.trim()}>
                Join Team
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
