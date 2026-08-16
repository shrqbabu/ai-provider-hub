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

  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
      toast.success("Signed in with Google!");
      navigate("/");
    } catch (err: unknown) {
      toast.error(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full h-full w-full aurora flex items-center justify-center p-4 sm:p-6 overflow-y-auto scrollbar-thin">
      <div className="w-full max-w-md my-auto space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-xl shadow-primary/20">
            <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 text-primary-foreground" />
          </div>
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold">AI Provider Hub</div>
            <div className="text-sm text-muted-foreground">
              {isSignup ? "Create your account" : "Sign in to continue"}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5 sm:p-6 shadow-2xl space-y-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-2.5 h-11 text-sm font-medium hover:bg-secondary/60 transition-colors"
            disabled={loading}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            Continue with Google
          </Button>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-border/60" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or email</span>
            <div className="flex-1 h-px bg-border/60" />
          </div>

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
              className="w-full h-11"
              disabled={loading}
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isSignup ? "Creating account…" : "Signing in…"}
                </>
              ) : isSignup ? (
                "Create account"
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
