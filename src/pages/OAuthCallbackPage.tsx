import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import {
  exchangeAntigravityCode,
  getAntigravityDefaultModels,
} from "@/services/antigravity-oauth";

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"processing" | "success" | "error">(
    "processing"
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const addProvider = useProviderStore((s) => s.add);
  const upsertModels = useModelStore((s) => s.upsertMany);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (error) {
      setStatus("error");
      setErrorMsg(errorDescription || error || "Authentication denied.");
      toast.error("OAuth authentication failed");
      return;
    }

    if (!code) {
      setStatus("error");
      setErrorMsg("No authorization code found in URL parameters.");
      return;
    }

    async function processOAuth() {
      try {
        const redirectUri = `${window.location.origin}/oauth/callback`;
        const tokens = await exchangeAntigravityCode(code!, redirectUri);

        const displayName = tokens.email
          ? `Antigravity (${tokens.email})`
          : "Antigravity (Google OAuth)";

        const newProvider = addProvider({
          key: "antigravity",
          name: "Antigravity",
          displayName,
          authMode: "oauth",
          apiKey: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiry: tokens.tokenExpiry,
          email: tokens.email,
          baseURL: "https://generativelanguage.googleapis.com/v1",
          streaming: true,
          vision: true,
          fileUpload: true,
        });

        const providerId = newProvider.id;

        // Add default models
        const defaultModels = getAntigravityDefaultModels().map((m) => ({
          ...m,
          id: `${providerId}-${m.modelId}`,
          providerId,
          providerKey: "antigravity" as const,
          pdf: true,
          working: true,
          createdAt: Date.now(),
        }));

        upsertModels(defaultModels);

        setStatus("success");
        toast.success("Antigravity connected successfully!");

        setTimeout(() => {
          navigate("/providers", { replace: true });
        }, 1500);
      } catch (err: unknown) {
        setStatus("error");
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Failed to exchange authorization code."
        );
      }
    }

    processOAuth();
  }, [searchParams, navigate, addProvider, upsertModels]);

  return (
    <div className="h-full w-full aurora flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-8 text-center space-y-4 shadow-2xl">
        {status === "processing" && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <h2 className="text-xl font-bold">Connecting Antigravity…</h2>
            <p className="text-sm text-muted-foreground">
              Exchanging authorization code and configuring your models.
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <h2 className="text-xl font-bold flex items-center gap-2 justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
              Successfully Connected!
            </h2>
            <p className="text-sm text-muted-foreground">
              Redirecting to your providers list…
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <h2 className="text-xl font-bold">Connection Failed</h2>
            <p className="text-sm text-destructive/90">{errorMsg}</p>
            <button
              onClick={() => navigate("/providers")}
              className="mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-xl font-medium transition hover:opacity-90"
            >
              Return to Providers
            </button>
          </div>
        )}
      </div>
    </div>
  );
}