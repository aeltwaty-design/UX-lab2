import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, configured } from "./supabase";

interface AuthState {
  loading: boolean;
  session: Session | null;
  isAdmin: boolean;
  adminChecked: boolean;
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  sendMagicLink: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      setAdminChecked(false);
      return;
    }
    let alive = true;
    setAdminChecked(false);
    supabase.rpc("is_admin").then(({ data }) => {
      if (!alive) return;
      setIsAdmin(Boolean(data));
      setAdminChecked(true);
    });
    return () => {
      alive = false;
    };
  }, [session]);

  const value: AuthState = {
    loading,
    session,
    isAdmin,
    adminChecked,
    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? error.message : null;
    },
    async sendMagicLink(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
      });
      return error ? error.message : null;
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
