import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm bg-white border border-line rounded-lg shadow-card p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <span className="h-9 w-9 rounded-sm bg-brand text-brand-ink grid place-items-center font-bold text-[14px]">RD</span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-ink">Research Desk</div>
            <div className="text-[12px] text-muted">#ux-research back office</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Login() {
  const { signInWithPassword, sendMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    const error = mode === "password" ? await signInWithPassword(email, password) : await sendMagicLink(email);
    setBusy(false);
    if (error) setErr(error);
    else if (mode === "link") setMsg("Check your inbox for the sign-in link.");
  }

  return (
    <Frame>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>Work email</Label>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@walaplus.com" />
        </div>
        {mode === "password" && (
          <div>
            <Label>Password</Label>
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        {err && <div className="text-[12.5px] text-danger">{err}</div>}
        {msg && <div className="text-[12.5px] text-brand-text">{msg}</div>}
        <Button variant="primary" className="w-full" loading={busy} onClick={undefined} {...{ type: "submit" }}>
          {mode === "password" ? "Sign in" : "Send sign-in link"}
        </Button>
        <button
          type="button"
          className="w-full text-[12px] text-muted hover:text-ink cursor-pointer"
          onClick={() => setMode(mode === "password" ? "link" : "password")}
        >
          {mode === "password" ? "Use an email link instead" : "Use a password instead"}
        </button>
      </form>
      <p className="text-[11.5px] text-muted mt-5">Only emails on the admin list can sign in. Colleagues never use this app; they answer in Slack.</p>
    </Frame>
  );
}

export function NotAdmin({ email }: { email: string }) {
  const { signOut } = useAuth();
  return (
    <Frame>
      <div className="text-[14px] font-semibold text-ink">This account is not on the admin list</div>
      <p className="text-[13px] text-muted mt-1">
        {email} signed in, but is not in the admins table. Add it with the SQL in the README, or sign in with the admin account.
      </p>
      <Button className="mt-4" onClick={() => void signOut()}>Sign out</Button>
    </Frame>
  );
}

export function Setup() {
  return (
    <Frame>
      <div className="text-[14px] font-semibold text-ink">Connect a Supabase project first</div>
      <ol className="text-[13px] text-ink-2 mt-2 space-y-1.5 list-decimal pl-5">
        <li>Create a project at supabase.com and run the migration in supabase/migrations.</li>
        <li>Copy .env.example to .env.local and fill in the project URL and anon key.</li>
        <li>Restart the dev server.</li>
      </ol>
      <p className="text-[11.5px] text-muted mt-4">The README walks through each step, including the Slack app.</p>
    </Frame>
  );
}
