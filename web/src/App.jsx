import * as React from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PanicOverlay } from "@/components/PanicOverlay";
import { GuardianProvider } from "@/lib/guardian";
import { useAuth, AuthProvider } from "@/lib/auth";
// gsap and the WebGL shader are only used by the sign-in screen, so they load
// with it rather than weighing down every other page.
const Auth = React.lazy(() => import("@/pages/Auth"));
import Dashboard from "@/pages/Dashboard";
import MapPage from "@/pages/MapPage";
import Report from "@/pages/Report";
import Contacts from "@/pages/Contacts";
import Evidence from "@/pages/Evidence";
import Profile from "@/pages/Profile";

function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RedirectIfAuthed({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : children;
}

/** Brief hold while a lazily-loaded screen arrives. */
function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <span className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function Routing() {
  return (
    <React.Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <Auth mode="login" />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfAuthed>
            <Auth mode="signup" />
          </RedirectIfAuthed>
        }
      />

      <Route
        element={
          <RequireAuth>
            {/*
              The guardian layer wraps every signed-in screen, not each page:
              a shake has to reach it wherever the user is, and a running
              evidence burst must survive navigation.
            */}
            <GuardianProvider>
              <AppShell />
              <PanicOverlay />
            </GuardianProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="map" element={<MapPage />} />
        <Route path="report" element={<Report />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="evidence" element={<Evidence />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </React.Suspense>
  );
}

export default function App() {
  // Theme is applied before first paint in main.jsx; this keeps it in sync if
  // the stored value changes in another tab.
  React.useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "protego.theme") {
        document.documentElement.classList.toggle("dark", e.newValue !== "light");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routing />
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--card)",
              color: "var(--card-foreground)",
              border: "1px solid var(--border)",
            },
          }}
        />
      </BrowserRouter>
    </AuthProvider>
  );
}
