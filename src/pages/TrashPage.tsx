import { Trash2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useChatStore } from "@/store/chat-store";
import { timeAgo, truncate } from "@/utils";
import { toast } from "sonner";

export function TrashPage() {
  const chats = useChatStore((s) => s.chats).filter((c) => c.deleted);
  const restore = useChatStore((s) => s.restore);
  const hardDelete = useChatStore((s) => s.hardDelete);
  const empty = useChatStore((s) => s.emptyTrash);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Trash2 className="w-5 h-5 md:w-6 md:h-6 text-primary" /> Trash
            </h1>
            <p className="text-sm text-muted-foreground">
              Deleted chats. Restore or permanently remove.
            </p>
          </div>
          {chats.length > 0 && (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("Permanently delete all trashed chats?")) {
                  empty();
                  toast.success("Trash emptied.");
                }
              }}
            >
              Empty trash
            </Button>
          )}
        </div>

        {chats.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-16">
            Trash is empty.
          </div>
        ) : (
          <div className="space-y-2">
            {chats.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {truncate(c.title, 60)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Deleted · updated {timeAgo(c.updatedAt)} · {c.messages.length} msgs
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      restore(c.id);
                      toast.success("Restored");
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm("Permanently delete?")) hardDelete(c.id);
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
