import { useState } from "react";
import { toast } from "sonner";
import { Loader2, PlugZap, TestTube2 } from "lucide-react";
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
import { ProviderLogo } from "@/components/ProviderLogo";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing?: ConnectedProvider;
}

interface FormState {
  key: ProviderKey;
  displayName: string;
  apiKey: string;
  baseURL: string;
  organization: string;
  extraHeaders: string;
  customLogo: string;
  streaming: boolean;
  vision: boolean;
  fileUpload: boolean;
  defaultModel: string;
}

const initial = (p?: ConnectedProvider): FormState => ({
  key: p?.key ?? "openai",
  displayName: p?.displayName ?? "",
  apiKey: p?.apiKey ?? "",
  baseURL: p?.baseURL ?? PROVIDERS.openai.baseURL,
  organization: p?.organization ?? "",
  extraHeaders: p?.extraHeaders ? JSON.stringify(p.extraHeaders, null, 2) : "",
  customLogo: p?.customLogo ?? "",
  streaming: p?.streaming ?? true,
  vision: p?.vision ?? true,
  fileUpload: p?.fileUpload ?? true,
  defaultModel: p?.defaultModel ?? "",
});

export function AddProviderDialog({ open, onOpenChange, existing }: Props) {
  const [form, setForm] = useState<FormState>(initial(existing));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const providerStore = useProviderStore();
  const modelStore = useModelStore();

  const isCustom = form.key === "custom";

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const onProviderChange = (key: ProviderKey) => {
    setForm((s) => {
      const wasCustom = s.key === "custom";
      const nextCustom = key === "custom";
      return {
        ...s,
        key,
        baseURL: PROVIDERS[key].baseURL || s.baseURL,
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
  > => ({
    key: form.key,
    name: PROVIDERS[form.key].name,
    displayName: form.displayName || PROVIDERS[form.key].name,
    apiKey: form.apiKey.trim(),
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
  });

  const handleTest = async () => {
    if (!form.apiKey || !form.baseURL) {
      toast.error("API key and base URL are required.");
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
    if (!form.apiKey || !form.baseURL) {
      toast.error("API key and base URL are required.");
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
            return {
              providerId,
              providerKey: form.key,
              modelId: m.id,
              displayName: m.id,
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
            Your API key stays on this device. Requests go directly from your
            browser to the provider — no backend proxy.
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

          <div className="space-y-1.5">
            <Label>API key</Label>
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder={isCustom ? "nvapi-... / sk-... / any bearer token" : "sk-..."}
              autoComplete="off"
            />
            {isCustom && (
              <p className="text-[11px] text-muted-foreground">
                Sent as <code>Authorization: Bearer &lt;key&gt;</code>. Works with
                NVIDIA NIM, Groq, Together, Fireworks, DeepInfra, Ollama, LM Studio, vLLM…
              </p>
            )}
          </div>

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
