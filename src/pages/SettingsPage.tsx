import { useRef } from "react";
import { Settings, Download, Upload, Trash2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input, Label } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/store/settings-store";
import { storage } from "@/services/storage";
import { toast } from "sonner";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { useChatStore } from "@/store/chat-store";
import { usePromptStore } from "@/store/prompt-store";
import { useUsageStore } from "@/store/usage-store";

export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    const data = {
      providers: useProviderStore.getState().providers,
      models: useModelStore.getState().models,
      chats: useChatStore.getState().chats,
      prompts: usePromptStore.getState().prompts,
      usage: useUsageStore.getState().usage,
      settings,
      exportedAt: Date.now(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-provider-hub-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported.");
  };

  const importAll = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.providers) await storage.set("providers", data.providers);
      if (data.models) await storage.set("models", data.models);
      if (data.chats) await storage.set("chats", data.chats);
      if (data.prompts) await storage.set("prompts", data.prompts);
      if (data.usage) await storage.set("usage", data.usage);
      if (data.settings) await storage.set("settings", data.settings);
      toast.success("Imported. Reloading...");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  };

  const clearAll = async () => {
    if (!confirm("This wipes ALL local data: providers, chats, models, prompts, usage. Continue?"))
      return;
    await storage.clear();
    toast.success("All data cleared. Reloading...");
    setTimeout(() => window.location.reload(), 800);
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2 mb-6">
          <Settings className="w-5 h-5 md:w-6 md:h-6 text-primary" /> Settings
        </h1>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Appearance
              </div>
              <Row label="Theme">
                <Select
                  value={settings.theme}
                  onValueChange={(v) =>
                    update({ theme: v as "light" | "dark" | "system" })
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Accent">
                <Select
                  value={settings.accent}
                  onValueChange={(v) => update({ accent: v })}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amber">Amber (default)</SelectItem>
                    <SelectItem value="rose">Rose</SelectItem>
                    <SelectItem value="violet">Violet</SelectItem>
                    <SelectItem value="emerald">Emerald</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Animations">
                <Switch
                  checked={settings.animations}
                  onCheckedChange={(v) => update({ animations: v })}
                />
              </Row>
              <Row label="Auto-scroll during streaming">
                <Switch
                  checked={settings.autoScroll}
                  onCheckedChange={(v) => update({ autoScroll: v })}
                />
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Chat
              </div>
              <Row label="Max output tokens">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={1024}
                    className="w-[140px]"
                    placeholder="Auto"
                    value={settings.maxTokens ? String(settings.maxTokens) : ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const n = raw === "" ? 0 : Math.max(0, Math.floor(Number(raw)));
                      update({ maxTokens: Number.isFinite(n) ? n : 0 });
                    }}
                  />
                </div>
              </Row>
              <p className="text-xs text-muted-foreground">
                Per-response output limit sent to the provider. Leave empty (Auto)
                for 16K tokens — 32K for reasoning models. If a response still hits
                the limit, the app auto-continues it in the same message. Higher
                values may be rejected by models with smaller output caps.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Data
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={exportAll}>
                  <Download className="w-4 h-4" /> Export all data
                </Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload className="w-4 h-4" /> Import
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importAll(f);
                  }}
                />
                <Button variant="outline" onClick={reset}>
                  <RotateCcw className="w-4 h-4" /> Reset settings
                </Button>
                <Button variant="destructive" onClick={clearAll}>
                  <Trash2 className="w-4 h-4" /> Wipe all data
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
                About
              </div>
              <p>
                AI Provider Hub is a fully frontend AI chat client. Your API keys, chats,
                and files are stored in your browser via IndexedDB and never sent to any
                server other than the AI provider you choose.
              </p>
              <p>
                Provider requests go directly from your browser using the OpenAI SDK
                with <code>dangerouslyAllowBrowser: true</code>. Some providers may
                require you to enable CORS or use a CORS-friendly endpoint.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm normal-case tracking-normal font-normal text-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
