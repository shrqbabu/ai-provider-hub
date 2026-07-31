import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useAuthStore } from "@/store/auth-store";

// Firebase auth errors carry a `code` (e.g. "auth/invalid-credential"). Map the
// common ones to clear, actionable messages so 400s from identitytoolkit make
// sense instead of showing a raw SDK string.
function authErrorMessage(err: unknown): string {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password. No account yet? Tap “Sign up” below.";
    case "auth/email-already-in-use":
      return "That email already has an account. Switch to “Sign in”.";
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/weak-password":
      return "Password is too weak — use at least 6 characters.";
    case "auth/operation-not-allowed":
      return "Email/Password sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.";
    case "auth/network-request-failed":
      return "Network error — check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/api-key-not-valid":
    case "auth/invalid-api-key":
      return "Firebase API key is invalid. Check VITE_FIREBASE_API_KEY in your env.";
    default:
      return err instanceof Error ? err.message : "Authentication failed.";
  }
}

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const signup = useAuthStore((s) => s.signup);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const isSignup = mode === "signup";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Email and password are required.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      if (isSignup) {
        await signup(email, password);
        toast.success("Account created! Signing you in…");
      } else {
        await login(email, password);
        toast.success("Signed in!");
      }
      navigate("/");
    } catch (err: unknown) {
      toast.error(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full aurora flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-xl shadow-primary/20">
            <Sparkles className="w-8 h-8 text-primary-foreground" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">AI Provider Hub</div>
            <div className="text-sm text-muted-foreground">
              {isSignup ? "Create your account" : "Sign in to continue"}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? "At least 6 characters" : "••••••••"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                disabled={loading}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isSignup ? "Creating account…" : "Signing in…"}
                </>
              ) : isSignup ? (
                "Sign up"
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </div>

        {/* Toggle */}
        <div className="text-center text-sm">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-primary hover:underline font-medium"
                disabled={loading}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don't have an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-primary hover:underline font-medium"
                disabled={loading}
              >
                Sign up
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
