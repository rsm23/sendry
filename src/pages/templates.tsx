import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Copy,
  Edit3,
  Eye,
  FileCode2,
  Link2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { get, patch, post, remove } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Template = {
  id: string;
  name: string;
  subject: string;
  plain_text: string;
  html_text: string;
  editor_mode: string;
  updated_at: string;
};

export default function TemplatesPage() {
  const { brand } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"blank" | "url" | "ai">("blank");
  const [name, setName] = useState("New template");
  const [url, setUrl] = useState("");
  const [task, setTask] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const query = useQuery({
    queryKey: ["templates", brand?.id],
    queryFn: () => get<Template[]>(`/api/brands/${brand?.id}/templates`),
    enabled: !!brand,
  });
  const create = useMutation({
    mutationFn: async () => {
      if (mode === "url")
        return post<Template>(`/api/brands/${brand?.id}/templates/import-url`, {
          url,
        });
      if (mode === "ai") {
        const generated = await post<{
          title: string;
          subject: string;
          plainText: string;
          html: string;
        }>(`/api/brands/${brand?.id}/ai/email`, {
          task,
          design: "Reusable editorial email template",
          requirements:
            "Accessible, responsive, one primary action and subscription links.",
        });
        return post<Template>(`/api/brands/${brand?.id}/templates`, {
          name: generated.title,
          subject: generated.subject,
          plain_text: generated.plainText,
          html_text: generated.html,
          editor_mode: "blocks",
          editor_data: {},
        });
      }
      return post<Template>(`/api/brands/${brand?.id}/templates`, {
        name,
        subject: "",
        plain_text: "",
        html_text:
          "<h1>Template headline</h1><p>Write your message.</p><p>[unsubscribe]</p>",
        editor_mode: "blocks",
        editor_data: {},
      });
    },
    onSuccess: async (template) => {
      await client.invalidateQueries({ queryKey: ["templates", brand?.id] });
      setCreateOpen(false);
      toast.success("Template created");
      setPreview(template);
    },
  });
  async function duplicate(template: Template) {
    await post(`/api/brands/${brand?.id}/templates`, {
      name: `${template.name} copy`,
      subject: template.subject,
      plain_text: template.plain_text,
      html_text: template.html_text,
      editor_mode: template.editor_mode,
      editor_data: {},
    });
    await query.refetch();
    toast.success("Template duplicated");
  }
  async function applyTemplate(template: Template) {
    const campaign = await post<{ id: string }>(
      `/api/brands/${brand?.id}/campaigns`,
      {
        subject: template.subject || template.name,
        label: template.name,
        from_name: brand?.from_name,
        from_email: brand?.from_email,
        reply_to: brand?.reply_to,
        plain_text: template.plain_text,
        html_text: template.html_text,
        editor_mode: template.editor_mode === "html" ? "html" : "blocks",
        editor_data: {},
        query_string: "",
        web_language: "en",
        opens_tracking: "identified",
        clicks_tracking: "identified",
        check_links: true,
        targets: [],
      },
    );
    navigate(`/campaigns/${campaign.id}`);
  }
  async function saveTemplate() {
    if (!preview) return;
    const saved = await patch<Template>(
      `/api/brands/${brand?.id}/templates/${preview.id}`,
      preview,
    );
    setPreview(saved);
    setEditing(false);
    await query.refetch();
    toast.success("Template saved");
  }
  async function generateTemplateSubject() {
    if (!preview) return;
    setAiBusy(true);
    try {
      const result = await post<{ subject: string }>(
        `/api/brands/${brand?.id}/ai/subject`,
        {
          content: preview.html_text || preview.plain_text,
          current: preview.subject,
          mode: "value",
        },
      );
      setPreview({ ...preview, subject: result.subject });
      toast.success("Template subject generated");
    } finally {
      setAiBusy(false);
    }
  }
  async function improveTemplate() {
    if (!preview) return;
    setAiBusy(true);
    try {
      const result = await post<{ content: string }>(
        `/api/brands/${brand?.id}/ai/improve`,
        {
          content: preview.html_text,
          instruction:
            "Improve clarity, hierarchy, accessibility and conversion while preserving facts, links and subscription tags.",
        },
      );
      setPreview({
        ...preview,
        html_text: result.content,
        plain_text: result.content.replace(/<[^>]+>/g, " "),
      });
      toast.success("Template content improved");
    } finally {
      setAiBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={brand?.name}
        title="Templates"
        description="Reusable email structures for campaigns and automated series."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> New template
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {query.data?.map((template) => (
          <Card key={template.id} className="overflow-hidden">
            <button
              className="relative block h-48 w-full overflow-hidden border-b bg-white text-start"
              onClick={() => setPreview(template)}
            >
              <iframe
                title={`${template.name} preview`}
                srcDoc={template.html_text}
                className="pointer-events-none h-[480px] w-[160%] origin-top-left scale-[.625]"
              />
              <span className="absolute inset-0 bg-transparent" />
            </button>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{template.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Updated {shortDate(template.updated_at)}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setPreview(template)}>
                      <Eye />
                      Preview
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void applyTemplate(template)}
                    >
                      <Edit3 />
                      Use in campaign
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void duplicate(template)}>
                      <Copy />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={async () => {
                        await remove(
                          `/api/brands/${brand?.id}/templates/${template.id}`,
                        );
                        await query.refetch();
                      }}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {template.subject || "No default subject"}
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void applyTemplate(template)}
              >
                <Edit3 /> Use template
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create a template</DialogTitle>
            <DialogDescription>
              Begin blank, import a public HTML page, or generate a complete
              draft.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: "blank", label: "Blank", icon: FileCode2 },
                { id: "url", label: "Import URL", icon: Link2 },
                { id: "ai", label: "Generate", icon: Sparkles },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setMode(item.id)}
                className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-sm ${mode === item.id ? "border-primary bg-primary/5 text-primary" : ""}`}
              >
                <item.icon className="size-5" />
                {item.label}
              </button>
            ))}
          </div>
          {mode === "blank" && (
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1.5"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          {mode === "url" && (
            <div>
              <Label>Public HTML URL</Label>
              <Input
                className="mt-1.5"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/newsletter.html"
              />
            </div>
          )}
          {mode === "ai" && (
            <div>
              <Label>What should this template do?</Label>
              <Textarea
                className="mt-1.5"
                rows={6}
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="A monthly product newsletter with release highlights…"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={
                create.isPending ||
                (mode === "url" && !url) ||
                (mode === "ai" && !task)
              }
            >
              {mode === "ai" ? <Bot /> : <Plus />}Create template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>
              {preview?.subject || "Template preview"}
            </DialogDescription>
          </DialogHeader>
          {editing && preview ? (
            <div className="space-y-3">
              <Input
                value={preview.name}
                onChange={(event) =>
                  setPreview({ ...preview, name: event.target.value })
                }
              />
              <Input
                value={preview.subject}
                onChange={(event) =>
                  setPreview({ ...preview, subject: event.target.value })
                }
                placeholder="Default subject"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={aiBusy}
                  onClick={() => void generateTemplateSubject()}
                >
                  <Bot className={aiBusy ? "animate-pulse" : ""} />
                  Generate subject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={aiBusy}
                  onClick={() => void improveTemplate()}
                >
                  <Sparkles />
                  Improve content
                </Button>
              </div>
              <Textarea
                rows={20}
                className="font-mono text-xs"
                value={preview.html_text}
                onChange={(event) =>
                  setPreview({ ...preview, html_text: event.target.value })
                }
              />
            </div>
          ) : (
            <iframe
              title="Template preview"
              srcDoc={preview?.html_text}
              className="h-[65svh] w-full border bg-white"
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                setEditing(false);
              }}
            >
              Close
            </Button>
            {preview && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit3 />
                Edit source
              </Button>
            )}
            {preview && editing && (
              <Button onClick={() => void saveTemplate()}>
                <Edit3 />
                Save template
              </Button>
            )}
            {preview && !editing && (
              <Button onClick={() => void applyTemplate(preview)}>
                <Edit3 />
                Use template
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
