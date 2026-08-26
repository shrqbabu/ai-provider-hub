import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Sparkles, Github, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useAuthStore } from "@/store/auth-store";

function authErrorMessage(err: unknown): string {
  if (!err) return "Authentication failed.";
  if (typeof err === "string") return err;
  
  const message = (err as any)?.message || "";
  const code = (err as any)?.code || "";

  if (message.includes("Invalid login credentials") || code === "invalid_credentials") {
    return "Invalid email or password. Don't have an account yet? Click Sign up below.";
  }
  if (message.includes("User already registered") || code === "user_already_exists") {
    return "An account with this email already exists. Please switch to Sign in.";
  }
  if (message.includes("Password should be at least")) {
    return "Password is too weak. Please use at least 6 characters.";
  }
  if (message.includes("Email not confirmed")) {
    return "Please confirm your email address or check your Supabase Auth settings.";
  }
  if (message.includes("rate limit") || code === "over_request_rate_limit") {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (message.includes("NetworkError") || message.includes("Failed to fetch")) {
    return "Network error. Please check your internet connection or Supabase URL.";
  }

  return message || "Authentication failed.";
}

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  const signup = useAuthStore((s) => s.signup);
  const login = useAuthStore((s) => s.login);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const loginWithGithub = useAuthStore((s) => s.loginWithGithub);
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
        toast.success("Account created successfully! Signing you in...");
      } else {
        await login(email, password);
        toast.success("Signed in successfully!");
      }
      navigate("/");
    } catch (err: unknown) {
      toast.error(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: "google" | "github") => {
    setOauthLoading(provider);
    try {
      if (provider === "google") {
        await loginWithGoogle();
      } else {
        await loginWithGithub();
      }
    } catch (err: unknown) {
      toast.error(authErrorMessage(err));
      setOauthLoading(null);
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

        {/* Auth Form Card */}
        <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5 sm:p-6 shadow-2xl space-y-4">
          {/* OAuth Buttons */}
          <div className="grid grid-cols-2 gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuthSignIn("google")}
              className="w-full flex items-center justify-center gap-2 h-11 text-xs sm:text-sm font-medium hover:bg-secondary/60 transition-colors"
              disabled={loading || Boolean(oauthLoading)}
            >
              {oauthLoading === "google" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
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
              )}
              <span>Google</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuthSignIn("github")}
              className="w-full flex items-center justify-center gap-2 h-11 text-xs sm:text-sm font-medium hover:bg-secondary/60 transition-colors"
              disabled={loading || Boolean(oauthLoading)}
            >
              {oauthLoading === "github" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Github className="w-4 h-4 shrink-0" />
              )}
              <span>GitHub</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-border/60" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or continue with email</span>
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
                disabled={loading || Boolean(oauthLoading)}
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
                disabled={loading || Boolean(oauthLoading)}
              />
            </div>
            <Button
              type="submit"
              className="w-full h-11"
              disabled={loading || Boolean(oauthLoading)}
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {isSignup ? "Creating account..." : "Signing in..."}
                </>
              ) : isSignup ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </div>

        {/* Toggle Mode */}
        <div className="text-center text-sm">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-primary hover:underline font-medium"
                disabled={loading || Boolean(oauthLoading)}
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
                disabled={loading || Boolean(oauthLoading)}
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
