import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, PlugZap, TestTube2, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVIDERS, PROVIDER_LIST } from "@/constants/providers";
import type { ConnectedProvider, ProviderKey } from "@/types";
import { useProviderStore } from "@/store/provider-store";
import { testConnection, fetchModelIds } from "@/services/provider-service";
import { useModelStore } from "@/store/model-store";
import { inferCapabilities, inferTier } from "@/constants/providers";
import { withClaudePrefix } from "@/utils/model-prefix";
import { ProviderLogo } from "@/components/ProviderLogo";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing?: ConnectedProvider;
}

interface FormState {
  key: ProviderKey;
  displayName: string;
  authMode: "apiKey" | "cookie";
  apiFormat: "openai" | "anthropic";
  apiKeys: string[];
  cookie: string;
  baseURL: string;
  organization: string;
  extraHeaders: string;
  customLogo: string;
  streaming: boolean;
  vision: boolean;
  fileUpload: boolean;
  defaultModel: string;
}

const initial = (p?: ConnectedProvider): FormState => {
  const key = p?.key ?? "openai";
  return {
    key,
    displayName: p?.displayName ?? "",
    authMode: p?.authMode ?? "apiKey",
    apiFormat: p?.apiFormat ?? (key === "anthropic" ? "anthropic" : "openai"),
    apiKeys: dedupeKeys([p?.apiKey ?? "", ...(p?.apiKeys ?? [])]).length
      ? dedupeKeys([p?.apiKey ?? "", ...(p?.apiKeys ?? [])])
      : [""],
    cookie: p?.cookie ?? "",
    baseURL: p?.baseURL ?? PROVIDERS[key].baseURL,
    organization: p?.organization ?? "",
    extraHeaders: p?.extraHeaders ? JSON.stringify(p.extraHeaders, null, 2) : "",
    customLogo: p?.customLogo ?? "",
    streaming: p?.streaming ?? true,
    vision: p?.vision ?? true,
    fileUpload: p?.fileUpload ?? true,
    defaultModel: p?.defaultModel ?? "",
  };
};

// Trim, drop empties, and de-dup while preserving order.
function dedupeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const t = k.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function AddProviderDialog({ open, onOpenChange, existing }: Props) {
  const [form, setForm] = useState<FormState>(initial(existing));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Record<number, boolean>>({});
  const providerStore = useProviderStore();
  const modelStore = useModelStore();

  useEffect(() => {
    if (open) {
      setForm(initial(existing));
      setVisibleKeys({});
    }
  }, [open, existing]);

  const toggleKeyVisibility = (index: number) => {
    setVisibleKeys((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const isCustom = form.key === "custom";
  const isCookie = form.authMode === "cookie";

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  // Multi-key helpers — the API key input is a dynamic, ordered list. The
  // gateway tries them top-to-bottom for fallback.
  const setKeyAt = (i: number, v: string) =>
    setForm((s) => {
      const apiKeys = [...s.apiKeys];
      apiKeys[i] = v;
      return { ...s, apiKeys };
    });
  const addKey = () =>
    setForm((s) => ({ ...s, apiKeys: [...s.apiKeys, ""] }));
  const removeKeyAt = (i: number) =>
    setForm((s) => {
      const apiKeys = s.apiKeys.filter((_, idx) => idx !== i);
      return { ...s, apiKeys: apiKeys.length ? apiKeys : [""] };
    });

  // First non-empty key = primary. Used for connection tests.
  const primaryKey = form.apiKeys.find((k) => k.trim()) ?? "";

  const onProviderChange = (key: ProviderKey) => {
    setForm((s) => {
      const wasCustom = s.key === "custom";
      const nextCustom = key === "custom";
      return {
        ...s,
        key,
        baseURL: PROVIDERS[key].baseURL || s.baseURL,
        // Anthropic → Messages API by default; other built-ins → OpenAI.
        apiFormat: key === "anthropic" ? "anthropic" : "openai",
        // Custom endpoints: don't auto-fill display name — user provides it.
        // For built-in providers: fill only if empty or previously auto-filled.
        displayName:
          nextCustom && (wasCustom || !s.displayName)
            ? ""
            : s.displayName && !Object.values(PROVIDERS).some((p) => p.name === s.displayName)
              ? s.displayName
              : PROVIDERS[key].name,
      };
    });
  };

  const parseHeaders = (): Record<string, string> | undefined => {
    if (!form.extraHeaders.trim()) return undefined;
    try {
      return JSON.parse(form.extraHeaders);
    } catch {
      toast.error("Extra headers must be valid JSON.");
      throw new Error("Invalid JSON headers");
    }
  };

  const buildProvider = (): Omit<
    ConnectedProvider,
    "id" | "connectedAt"
  > => {
    const keys = dedupeKeys(form.apiKeys);
    return {
      key: form.key,
      name: PROVIDERS[form.key].name,
      displayName: form.displayName || PROVIDERS[form.key].name,
      authMode: form.authMode,
      apiFormat: form.apiFormat,
      apiKey: keys[0] ?? "",
      apiKeys: keys,
      cookie: form.authMode === "cookie" ? form.cookie.trim() : undefined,
      baseURL: form.baseURL.trim(),
      organization: form.organization.trim() || undefined,
      extraHeaders: parseHeaders(),
      isCustom,
      customLogo: form.customLogo || undefined,
      streaming: form.streaming,
      vision: form.vision,
      fileUpload: form.fileUpload,
      defaultModel: form.defaultModel || undefined,
      lastCheckedAt: Date.now(),
    };
  };

  const handleTest = async () => {
    if (isCookie ? !form.cookie.trim() : !primaryKey) {
      toast.error(
        isCookie
          ? "Cookie and base URL are required."
          : "API key and base URL are required."
      );
      return;
    }
    if (!form.baseURL) {
      toast.error("Base URL is required.");
      return;
    }
    try {
      new URL(form.baseURL);
    } catch {
      toast.error("Base URL must be a valid URL, e.g. https://integrate.api.nvidia.com/v1");
      return;
    }
    setTesting(true);
    try {
      const payload = buildProvider();
      const res = await testConnection({
        id: "test",
        connectedAt: 0,
        ...payload,
      });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } catch {
      // handled
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (isCookie ? !form.cookie.trim() : !primaryKey) {
      toast.error(
        isCookie
          ? "Cookie and base URL are required."
          : "API key and base URL are required."
      );
      return;
    }
    if (!form.baseURL) {
      toast.error("Base URL is required.");
      return;
    }
    try {
      new URL(form.baseURL);
    } catch {
      toast.error("Base URL must be a valid URL, e.g. https://integrate.api.nvidia.com/v1");
      return;
    }
    if (!form.displayName.trim() && isCustom) {
      toast.error("Give this provider a display name.");
      return;
    }
    setSaving(true);
    try {
      const payload = buildProvider();
      const test = await testConnection({
        id: "test",
        connectedAt: 0,
        ...payload,
      });
      if (!test.ok) {
        toast.error(test.message);
        setSaving(false);
        return;
      }

      let providerId: string;
      if (existing) {
        providerStore.update(existing.id, payload);
        providerId = existing.id;
      } else {
        const created = providerStore.add(payload);
        providerId = created.id;
      }

      // Auto-fetch models
      if (PROVIDERS[form.key].supportsModelsList) {
        try {
          const list = await fetchModelIds({
            id: providerId,
            connectedAt: 0,
            ...payload,
          });
          const models = list.map((m) => {
            const caps = inferCapabilities(m.id);
            // Prefer values the API actually returned; fall back to our lookup.
            const inputPrice = m.inputPrice ?? caps.inputPrice;
            const outputPrice = m.outputPrice ?? caps.outputPrice;
            const contextWindow = m.contextLength ?? caps.context;
            const tier = inferTier({
              providerKey: form.key,
              modelId: m.id,
              baseURL: form.baseURL,
              inputPrice,
              outputPrice,
            });
            // Claude models get the virtual "aip/" prefix so they show up (and
            // are callable) as aip/<id> everywhere. Non-Claude ids are untouched.
            const displayId = withClaudePrefix(m.id);
            return {
              providerId,
              providerKey: form.key,
              modelId: displayId,
              displayName: displayId,
              contextWindow,
              vision: m.supportsVision ?? caps.vision,
              pdf: caps.pdf,
              streaming: caps.streaming,
              toolCalling: caps.toolCalling,
              reasoning: caps.reasoning,
              inputPrice,
              outputPrice,
              tier,
              createdAt: m.created ? m.created * 1000 : Date.now(),
            };
          });
          modelStore.upsertMany(models);
          toast.success(`Connected — ${models.length} models discovered.`);
        } catch (err) {
          toast.warning(
            `Connected, but model discovery failed: ${
              err instanceof Error ? err.message : "unknown"
            }`
          );
        }
      } else {
        toast.success("Connected. Add models manually from the Models page.");
      }

      onOpenChange(false);
      setForm(initial());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderLogo provider={form.key} className="w-8 h-8" />
            {existing ? "Edit provider" : "Connect a provider"}
          </DialogTitle>
          <DialogDescription>
            Your keys are stored securely in your account. Add multiple keys per
            provider for automatic fallback across your unified gateway.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={form.key}
              onValueChange={(v) => onProviderChange(v as ProviderKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_LIST.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input
              value={form.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              placeholder={
                isCustom ? "e.g. NVIDIA NIM, Groq, Ollama…" : PROVIDERS[form.key].name
              }
            />
          </div>

          {isCustom && (
            <div className="space-y-1.5">
              <Label>Auth method</Label>
              <Select
                value={form.authMode}
                onValueChange={(v) => set("authMode", v as "apiKey" | "cookie")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="apiKey">API key (Bearer token)</SelectItem>
                  <SelectItem value="cookie">Cookie / session</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!isCookie && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>
                  API key{form.apiKeys.filter((k) => k.trim()).length > 1 ? "s" : ""}
                </Label>
                <button
                  type="button"
                  onClick={addKey}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <Plus className="w-3 h-3" />
                  Add fallback key
                </button>
              </div>
              <div className="space-y-2">
                {form.apiKeys.map((k, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={visibleKeys[i] ? "text" : "password"}
                        value={k}
                        onChange={(e) => setKeyAt(i, e.target.value)}
                        placeholder={
                          i === 0
                            ? isCustom
                              ? "nvapi-... / sk-... / any bearer token"
                              : "sk-..."
                            : "Fallback key"
                        }
                        className={form.apiKeys.length > 1 ? "pr-20" : "pr-9"}
                        autoComplete="off"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                        {form.apiKeys.length > 1 && (
                          <span className="text-[10px] text-muted-foreground pointer-events-none select-none">
                            {i === 0 ? "primary" : `#${i + 1}`}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleKeyVisibility(i)}
                          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                          title={visibleKeys[i] ? "Hide API key" : "Show API key"}
                          tabIndex={-1}
                        >
                          {visibleKeys[i] ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    {form.apiKeys.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeKeyAt(i)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition shrink-0"
                        aria-label="Remove key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {isCustom ? (
                  <>
                    Sent as <code>Authorization: Bearer &lt;key&gt;</code>.{" "}
                  </>
                ) : null}
                Add multiple keys for automatic fallback — the gateway tries them
                top-to-bottom when one hits a rate limit or auth error.
              </p>
            </div>
          )}

          {isCookie && (
            <div className="space-y-1.5">
              <Label>Cookie</Label>
              <Textarea
                value={form.cookie}
                onChange={(e) => set("cookie", e.target.value)}
                placeholder="session=abc123; token=xyz789"
                className="font-mono text-xs"
                rows={3}
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground">
                Sent as the <code>Cookie</code> header via the proxy. For self-hosted /
                OpenAI-compatible gateways that use session cookies. Needs a hosted
                https base URL (not localhost).
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={form.baseURL}
              onChange={(e) => set("baseURL", e.target.value)}
              placeholder={
                isCustom
                  ? "https://integrate.api.nvidia.com/v1"
                  : PROVIDERS[form.key].baseURL
              }
            />
          </div>

          {!isCookie && (
            <div className="space-y-1.5">
              <Label>API format</Label>
              <Select
                value={form.apiFormat}
                onValueChange={(v) => set("apiFormat", v as "openai" | "anthropic")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">
                    OpenAI compatible (/chat/completions)
                  </SelectItem>
                  <SelectItem value="anthropic">
                    Anthropic Messages (/v1/messages)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Pick <code>Anthropic Messages</code> for api.anthropic.com or
                Claude-native gateways that don't expose an OpenAI
                <code>/chat/completions</code> path.
              </p>
            </div>
          )}

          {!isCustom && (
            <div className="space-y-1.5">
              <Label>Organization (optional)</Label>
              <Input
                value={form.organization}
                onChange={(e) => set("organization", e.target.value)}
              />
            </div>
          )}

          {!isCustom && (
            <div className="space-y-1.5">
              <Label>Extra headers (optional JSON)</Label>
              <Textarea
                value={form.extraHeaders}
                onChange={(e) => set("extraHeaders", e.target.value)}
                placeholder='{"HTTP-Referer": "https://example.com"}'
                className="font-mono text-xs"
                rows={3}
              />
            </div>
          )}

          {isCustom && (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Optional
              </div>
              <div className="space-y-1.5">
                <Label>Default model (optional)</Label>
                <Input
                  value={form.defaultModel}
                  onChange={(e) => set("defaultModel", e.target.value)}
                  placeholder="meta/llama-3.1-70b-instruct"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Custom logo URL (optional)</Label>
                <Input
                  value={form.customLogo}
                  onChange={(e) => set("customLogo", e.target.value)}
                  placeholder="https://.../logo.png"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <ToggleRow
                  label="Streaming"
                  value={form.streaming}
                  onChange={(v) => set("streaming", v)}
                />
                <ToggleRow
                  label="Vision"
                  value={form.vision}
                  onChange={(v) => set("vision", v)}
                />
                <ToggleRow
                  label="Uploads"
                  value={form.fileUpload}
                  onChange={(v) => set("fileUpload", v)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || saving}
          >
            {testing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube2 className="w-4 h-4" />
            )}
            Test
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <PlugZap className="w-4 h-4" />
            )}
            {existing ? "Save changes" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 p-2">
      <span className="text-xs">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
