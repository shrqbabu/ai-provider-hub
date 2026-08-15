import { useRef } from "react";
import { Settings, Download, Upload, Trash2, RotateCcw, Database, HardDrive, CheckCircle2 } from "lucide-react";
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
import { useComboStore } from "@/store/combo-store";
import { useKeyStoreStore } from "@/store/keystore-store";

export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  const fileRef = useRef<HTMLInputElement>(null);
  const providers = useProviderStore((s) => s.providers);
  const models = useModelStore((s) => s.models);
  const combos = useComboStore((s) => s.combos);
  const chats = useChatStore((s) => s.chats);
  const prompts = usePromptStore((s) => s.prompts);
  const keystore = useKeyStoreStore((s) => s.items);
  const usage = useUsageStore((s) => s.usage);

  const exportAll = async () => {
    const backupData = {
      version: 1,
      appName: "AI Provider Hub",
      exportedAt: Date.now(),
      providers: useProviderStore.getState().providers,
      models: useModelStore.getState().models,
      combos: useComboStore.getState().combos,
      chats: useChatStore.getState().chats,
      prompts: usePromptStore.getState().prompts,
      keystore: useKeyStoreStore.getState().items,
      usage: useUsageStore.getState().usage,
      settings: useSettingsStore.getState().settings,
    };

    const countSummary = `${backupData.providers.length} providers, ${backupData.models.length} models, ${backupData.combos.length} combos, ${backupData.chats.length} chats`;

    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `ai-provider-hub-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported complete backup (${countSummary})`);
  };

  const importAll = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (typeof data !== "object" || data === null) {
        throw new Error("Invalid backup JSON file.");
      }

      let count = 0;
      if (Array.isArray(data.providers)) {
        await storage.set("providers", data.providers);
        useProviderStore.setState({ providers: data.providers });
        count++;
      }
      if (Array.isArray(data.models)) {
        await storage.set("models", data.models);
        useModelStore.setState({ models: data.models });
        count++;
      }
      if (Array.isArray(data.combos)) {
        await storage.set("combos", data.combos);
        useComboStore.setState({ combos: data.combos });
        count++;
      }
      if (Array.isArray(data.chats)) {
        await storage.set("chats", data.chats);
        useChatStore.setState({ chats: data.chats });
        count++;
      }
      if (Array.isArray(data.prompts)) {
        await storage.set("prompts", data.prompts);
        usePromptStore.setState({ prompts: data.prompts });
        count++;
      }
      if (Array.isArray(data.keystore)) {
        await storage.set("keystore", data.keystore);
        useKeyStoreStore.setState({ items: data.keystore });
        count++;
      }
      if (data.usage && typeof data.usage === "object") {
        await storage.set("usage", data.usage);
        useUsageStore.setState({ usage: data.usage });
        count++;
      }
      if (data.settings && typeof data.settings === "object") {
        await storage.set("settings", data.settings);
        useSettingsStore.setState({ settings: data.settings });
        count++;
      }

      // Also sync to /api/backup backend endpoint
      try {
        await fetch("/api/backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        });
      } catch {
        // ignore network error
      }

      toast.success(`Import successful (${count} datasets restored). Reloading...`);
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : "Invalid JSON file"}`
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
              <Row label="Default Model / Combo">
                <Select
                  value={settings.defaultModelId || "none_selected_value"}
                  onValueChange={(v) =>
                    update({ defaultModelId: v === "none_selected_value" ? "" : v })
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="No default model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none_selected_value">None</SelectItem>
                    {combos.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-[10px] uppercase font-bold text-muted-foreground tracking-wider border-b border-border/30 pb-0.5">
                          Combos
                        </div>
                        {combos.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                    <div className="px-2 py-1 text-[10px] uppercase font-bold text-muted-foreground tracking-wider border-b border-border/30 pb-0.5 mt-2">
                      Models
                    </div>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
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
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-primary" /> Data Storage & Backup (VPS SQLite / Local DB)
                </div>
                <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Persistent Storage Active
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 rounded-lg bg-secondary/50 border border-border/40">
                  <div className="text-muted-foreground text-[10px] uppercase">Providers</div>
                  <div className="font-semibold text-sm mt-0.5">{providers.length}</div>
                </div>
                <div className="p-2 rounded-lg bg-secondary/50 border border-border/40">
                  <div className="text-muted-foreground text-[10px] uppercase">Models</div>
                  <div className="font-semibold text-sm mt-0.5">{models.length}</div>
                </div>
                <div className="p-2 rounded-lg bg-secondary/50 border border-border/40">
                  <div className="text-muted-foreground text-[10px] uppercase">Combos</div>
                  <div className="font-semibold text-sm mt-0.5">{combos.length}</div>
                </div>
                <div className="p-2 rounded-lg bg-secondary/50 border border-border/40">
                  <div className="text-muted-foreground text-[10px] uppercase">Chats</div>
                  <div className="font-semibold text-sm mt-0.5">{chats.length}</div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                All your providers, API keys, models, chats, prompt templates, and gateway keys are safely stored in your VPS SQLite / local persistent database (<code>./data/hub_store.json</code>).
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="default" onClick={exportAll} className="gap-1.5">
                  <Download className="w-4 h-4" /> Export Backup (JSON)
                </Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5">
                  <Upload className="w-4 h-4" /> Import Backup (JSON)
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
                <Button variant="destructive" onClick={clearAll} className="ml-auto">
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
