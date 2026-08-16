import { useState } from "react";
import { toast } from "sonner";
import {
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Sparkles,
  KeyRound,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import {
  getAntigravityOAuthUrl,
  parseCallbackUrlOrCode,
  exchangeAntigravityCode,
  getAntigravityDefaultModels,
  CLI_REDIRECT_URI,
} from "@/services/antigravity-oauth";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AntigravityOAuthDialog({ open, onOpenChange }: Props) {
  const [callbackInput, setCallbackInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [useCliRedirect, setUseCliRedirect] = useState(true);

  const addProvider = useProviderStore((s) => s.add);
  const upsertModels = useModelStore((s) => s.upsertMany);

  const authUrl = getAntigravityOAuthUrl();

  const handleCopyAuthUrl = () => {
    navigator.clipboard.writeText(authUrl);
    setCopiedUrl(true);
    toast.success("Google OAuth URL copied to clipboard");
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleOpenAuthUrl = () => {
    window.open(authUrl, "_blank", "noopener,noreferrer");
    toast.info("Google login opened in new tab. After login, paste the redirected URL below.");
  };

  const handleConnect = async () => {
    const parsed = parseCallbackUrlOrCode(callbackInput);

    if (parsed.error) {
      toast.error(parsed.error);
      return;
    }

    if (!parsed.code) {
      toast.error("Please paste the callback URL or authorization code from Google.");
      return;
    }

    setLoading(true);
    const toastId = toast.loading("Exchanging code and connecting Google Antigravity...");

    try {
      const redirectUriToUse = parsed.redirectUri || CLI_REDIRECT_URI;
      const tokens = await exchangeAntigravityCode(parsed.code, redirectUriToUse);

      const displayName = tokens.email
        ? `Antigravity (${tokens.email})`
        : "Antigravity (Google OAuth)";

      // Add Antigravity Provider
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

      // Populate default models
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

      toast.success(
        `Connected to Antigravity successfully! Added ${defaultModels.length} models.`,
        { id: toastId }
      );

      setCallbackInput("");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Connection failed: ${err.message || "Unknown error"}`, {
        id: toastId,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
            Connect Antigravity (Google OAuth)
          </DialogTitle>
          <DialogDescription>
            Authenticate via Google OAuth to connect Antigravity and access Gemini 2.5 Pro, Claude Sonnet 3.7/3.5, and Flash models.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Step 1: Open Google OAuth */}
          <div className="rounded-2xl border border-border/80 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                  1
                </span>
                Open Google Sign-in
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAuthUrl}
                  className="h-8 gap-1.5 text-xs"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUrl ? "Copied" : "Copy Link"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleOpenAuthUrl}
                  className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Sign In with Google
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Click the button above to log in with your Google account. Grant permissions when prompted.
            </p>
          </div>

          {/* Step 2: Paste callback URL */}
          <div className="rounded-2xl border border-border/80 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                2
              </span>
              Paste Callback URL or Code
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              After signing in on Google, your browser will redirect to a callback page (e.g. <code className="bg-background/80 px-1 py-0.5 rounded text-[11px]">http://127.0.0.1:20128/callback?code=...</code>). Copy the entire address bar URL and paste it below:
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="callback-url" className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5" />
                Callback URL or Authorization Code
              </Label>
              <Input
                id="callback-url"
                placeholder="Paste URL (http://127.0.0.1:20128/callback?code=4/0Ab...) or code"
                value={callbackInput}
                onChange={(e) => setCallbackInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && callbackInput.trim()) {
                    e.preventDefault();
                    handleConnect();
                  }
                }}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Extra Help info */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
            <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Note:</strong> If you see a &quot;Site cannot be reached&quot; page on localhost after logging in, that is normal. Just copy the full URL from your browser address bar and paste it above.
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConnect}
            disabled={loading || !callbackInput.trim()}
            className="gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Connect Account
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
