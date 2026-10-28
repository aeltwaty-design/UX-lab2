import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { configured } from "@/lib/supabase";
import { googleRedirectUri, runAdminAction } from "@/data/queries";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Empty";
import { AppShell } from "@/components/AppShell";
import Login, { NotAdmin, Setup } from "@/pages/Login";
import Studies from "@/pages/Studies";
import StudyBuilder from "@/pages/StudyBuilder";
import StudyResults from "@/pages/StudyResults";
import ResultsPost from "@/pages/ResultsPost";
import Announcements from "@/pages/Announcements";
import AnnouncementEditor from "@/pages/AnnouncementEditor";
import Participants from "@/pages/Participants";
import Friction from "@/pages/Friction";
import Settings from "@/pages/Settings";

// After Settings → Google Calendar → Connect, Google sends the browser back to the app's root with ?code=…&state=….
// The query is read here at load, before the index route redirects to /studies and drops it.
const LANDING = new URLSearchParams(window.location.search);

function GoogleReturn() {
  const nav = useNavigate();
  const toast = useToast();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const code = LANDING.get("code");
    const state = LANDING.get("state") ?? "";
    const err = LANDING.get("error");
    if (!code && !err) return;
    done.current = true;
    for (const k of ["code", "state", "error", "scope", "authuser", "prompt", "hd"]) LANDING.delete(k);
    (async () => {
      if (!code) {
        toast(err === "access_denied" ? "Google sign-in was cancelled." : `Google sign-in failed (${err}).`, "error");
      } else {
        const r = await runAdminAction({ action: "google_connect", code, state, redirect_uri: googleRedirectUri() });
        toast(r.message, r.ok ? "ok" : "error");
      }
      nav("/settings", { replace: true });
    })();
  }, [nav, toast]);
  return null;
}

function Gate() {
  const { loading, session, isAdmin, adminChecked } = useAuth();
  if (!configured) return <Setup />;
  if (loading) return <Spinner label="Checking your session" />;
  if (!session) return <Login />;
  if (!adminChecked) return <Spinner label="Checking your access" />;
  if (!isAdmin) return <NotAdmin email={session.user.email ?? ""} />;
  return (
    <>
      <GoogleReturn />
      <AppShell />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route element={<Gate />}>
            <Route index element={<Navigate to="/studies" replace />} />
            <Route path="/studies" element={<Studies />} />
            <Route path="/studies/new" element={<StudyBuilder />} />
            <Route path="/studies/:id" element={<StudyResults />} />
            <Route path="/studies/:id/edit" element={<StudyBuilder />} />
            <Route path="/studies/:id/post" element={<ResultsPost />} />
            <Route path="/announcements" element={<Announcements />} />
            <Route path="/announcements/new" element={<AnnouncementEditor />} />
            <Route path="/announcements/:id" element={<AnnouncementEditor />} />
            <Route path="/participants" element={<Participants />} />
            <Route path="/friction" element={<Friction />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/studies" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
