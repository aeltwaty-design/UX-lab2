import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { configured } from "@/lib/supabase";
import { ToastProvider } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Empty";
import { AppShell } from "@/components/AppShell";
import Login, { NotAdmin, Setup } from "@/pages/Login";
import Studies from "@/pages/Studies";
import StudyBuilder from "@/pages/StudyBuilder";
import StudyResults from "@/pages/StudyResults";
import ResultsPost from "@/pages/ResultsPost";
import Participants from "@/pages/Participants";
import Friction from "@/pages/Friction";
import Settings from "@/pages/Settings";

function Gate() {
  const { loading, session, isAdmin, adminChecked } = useAuth();
  if (!configured) return <Setup />;
  if (loading) return <Spinner label="Checking your session" />;
  if (!session) return <Login />;
  if (!adminChecked) return <Spinner label="Checking your access" />;
  if (!isAdmin) return <NotAdmin email={session.user.email ?? ""} />;
  return <AppShell />;
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
