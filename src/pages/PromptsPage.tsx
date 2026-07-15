import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Plus,
  Search,
  Star,
  Copy,
  Trash2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { usePromptStore } from "@/store/prompt-store";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils";
import type { Prompt } from "@/types";

export function PromptsPage() {
  const prompts = usePromptStore((s) => s.prompts);
  const add = usePromptStore((s) => s.add);
  const update = usePromptStore((s) => s.update);
  const remove = usePromptStore((s) => s.remove);
  const duplicate = usePromptStore((s) => s.duplicate);
  const toggleFav = usePromptStore((s) => s.toggleFavorite);

  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("all");
  const [dialog, setDialog] = useState<{ open: boolean; editing?: Prompt }>({
    open: false,
  });
  const [f, setF] = useState({ title: "", content: "", tags: "", folder: "" });

  const folders = useMemo(() => {
    const set = new Set<string>();
    prompts.forEach((p) => p.folder && set.add(p.folder));
    return Array.from(set);
  }, [prompts]);

  const filtered = useMemo(() => {
    let list = prompts;
    if (folder !== "all") {
      list =
        folder === "favorites"
          ? list.filter((p) => p.favorite)
          : list.filter((p) => p.folder === folder);
    }
    if (q) {
      const s = q.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(s) ||
          p.content.toLowerCase().includes(s) ||
          p.tags.some((t) => t.toLowerCase().includes(s))
      );
    }
    return list;
  }, [prompts, folder, q]);

  const openNew = () => {
    setF({ title: "", content: "", tags: "", folder: "" });
    setDialog({ open: true });
  };

  const openEdit = (p: Prompt) => {
    setF({
      title: p.title,
      content: p.content,
      tags: p.tags.join(", "),
      folder: p.folder ?? "",
    });
    setDialog({ open: true, editing: p });
  };

  const save = () => {
    if (!f.title.trim() || !f.content.trim()) {
      toast.error("Title and content are required.");
      return;
    }
    const payload = {
      title: f.title.trim(),
      content: f.content.trim(),
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      folder: f.folder.trim() || undefined,
    };
    if (dialog.editing) update(dialog.editing.id, payload);
    else add(payload);
    setDialog({ open: false });
    toast.success(dialog.editing ? "Updated" : "Added");
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <BookOpen className="w-5 h-5 md:w-6 md:h-6 text-primary" /> Prompt Library
            </h1>
            <p className="text-sm text-muted-foreground">
              Save reusable prompts. Copy them into any chat.
            </p>
          </div>
          <Button onClick={openNew}>
            <Plus className="w-4 h-4" /> New prompt
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search prompts..."
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            <FolderChip active={folder === "all"} onClick={() => setFolder("all")}>
              All
            </FolderChip>
            <FolderChip
              active={folder === "favorites"}
              onClick={() => setFolder("favorites")}
            >
              <Star className="w-3 h-3" /> Favorites
            </FolderChip>
            {folders.map((f) => (
              <FolderChip key={f} active={folder === f} onClick={() => setFolder(f)}>
                {f}
              </FolderChip>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-16">
            No prompts yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <motion.div
                key={p.id}
                layout
                whileHover={{ y: -2 }}
              >
                <Card className="h-full">
                  <CardContent className="p-4 flex flex-col gap-2 h-full">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm truncate flex-1">
                        {p.title}
                      </h3>
                      <button
                        onClick={() => toggleFav(p.id)}
                        className="p-1 rounded hover:bg-secondary"
                      >
                        <Star
                          className={cn(
                            "w-4 h-4",
                            p.favorite
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground"
                          )}
                        />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                      {p.content}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.folder && (
                        <Badge variant="outline">{p.folder}</Badge>
                      )}
                      {p.tags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-1 mt-auto pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          navigator.clipboard.writeText(p.content);
                          toast.success("Copied to clipboard");
                        }}
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(p)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => duplicate(p.id)}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => remove(p.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        <Dialog open={dialog.open} onOpenChange={(v) => setDialog({ open: v })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {dialog.editing ? "Edit prompt" : "New prompt"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  value={f.title}
                  onChange={(e) => setF({ ...f, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Content</Label>
                <Textarea
                  rows={8}
                  value={f.content}
                  onChange={(e) => setF({ ...f, content: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Folder</Label>
                  <Input
                    value={f.folder}
                    onChange={(e) => setF({ ...f, folder: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tags (comma-separated)</Label>
                  <Input
                    value={f.tags}
                    onChange={(e) => setF({ ...f, tags: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialog({ open: false })}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function FolderChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 h-10 rounded-xl border text-sm flex items-center gap-1.5 transition",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border bg-background/40 hover:bg-secondary"
      )}
    >
      {children}
    </button>
  );
}
