import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallAppBanner() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(
    () => localStorage.getItem("aihub-install-dismissed") === "1"
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden || !evt) return null;

  return (
    <div className="md:hidden mx-3 mb-2 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/15 to-violet-500/10 p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
        <Download className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">Install Android app</div>
        <div className="text-[11px] text-muted-foreground">
          Add to home screen — works offline, feels native.
        </div>
      </div>
      <Button
        size="sm"
        onClick={async () => {
          await evt.prompt();
          setEvt(null);
        }}
      >
        Install
      </Button>
      <button
        className="p-1 rounded-lg hover:bg-secondary"
        onClick={() => {
          localStorage.setItem("aihub-install-dismissed", "1");
          setHidden(true);
        }}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
