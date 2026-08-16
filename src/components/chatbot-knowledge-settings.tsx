import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Copy,
  ExternalLink,
  FilePlus2,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { api, get, patch, post, remove } from "@/lib/api";
import { useI18n } from "@/i18n/context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Widget = {
  id: string;
  public_key: string;
  name: string;
  greeting: string;
  allowed_origins: string | string[];
  agent_enabled: number | boolean;
  enabled: number | boolean;
  agent_instructions: string;
  handoff_message: string;
  min_similarity: number;
  ready_sources: number;
  indexing_sources: number;
  failed_sources: number;
};
type FileItem = {
  id: string;
  kind: string;
  name: string;
  mime_type?: string;
  size?: number;
};
type Document = {
  id: string;
  file_id: string;
  filename: string;
  status: string;
  progress: number;
  chunk_count: number;
  error_message?: string;
  error_code?: string;
};
type TestResult = {
  outcome: string;
  answer: string;
  reason?: string;
  evidence: Array<{
    file_id: string;
    filename: string;
    location: Record<string, unknown>;
    excerpt: string;
    score: number;
  }>;
};

function origins(value: Widget["allowed_origins"]) {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function location(value: Record<string, unknown>) {
  if (value.page) return `Page ${value.page}`;
  if (value.slide) return `Slide ${value.slide}`;
  if (value.sheet)
    return `${value.sheet} · rows ${value.row_start ?? "?"}–${value.row_end ?? "?"}`;
  return String(value.section || "Document");
}

export function ChatbotKnowledgeSettings({ brandId }: { brandId: string }) {
  const { t } = useI18n(),
    queryClient = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const widgets = useQuery({
    queryKey: ["chatbots", brandId],
    queryFn: () =>
      get<{ data: Widget[] }>(`/api/v2/brands/${brandId}/chatbots`).then(
        (value) => value.data,
      ),
  });
  const featureFlags = useQuery({ queryKey: ["channel-flags", brandId], queryFn: () => get<{ data: Record<string, boolean> }>(`/api/v2/brands/${brandId}/feature-flags`).then((value) => value.data) });
  const [widgetId, setWidgetId] = useState(""),
    [draft, setDraft] = useState<Widget>(),
    [fileId, setFileId] = useState(""),
    [question, setQuestion] = useState(""),
    [testResult, setTestResult] = useState<TestResult>();
  useEffect(() => {
    if (!widgetId && widgets.data?.[0]) setWidgetId(widgets.data[0].id);
  }, [widgetId, widgets.data]);
  useEffect(() => {
    const item = widgets.data?.find((widget) => widget.id === widgetId);
    if (item)
      setDraft({ ...item, allowed_origins: origins(item.allowed_origins) });
  }, [widgetId, widgets.data]);
  const documents = useQuery({
    queryKey: ["chatbot-knowledge", brandId, widgetId],
    queryFn: () =>
      get<{ data: Document[] }>(
        `/api/v2/brands/${brandId}/chatbots/${widgetId}/knowledge`,
      ).then((value) => value.data),
    enabled: Boolean(widgetId),
    refetchInterval: (query) =>
      query.state.data?.some((item) =>
        ["queued", "processing"].includes(item.status),
      )
        ? 1500
        : false,
  });
  const files = useQuery({
    queryKey: ["files-for-chatbot", brandId],
    queryFn: () => get<FileItem[]>(`/api/brands/${brandId}/files?view=all&limit=200`),
    enabled: Boolean(widgetId),
  });
  const save = useMutation({
    mutationFn: () =>
      patch(`/api/v2/brands/${brandId}/chatbots/${widgetId}`, {
        ...draft,
        allowed_origins: origins(draft?.allowed_origins ?? []).filter(Boolean),
        ready_sources: undefined,
        indexing_sources: undefined,
        failed_sources: undefined,
        public_key: undefined,
        id: undefined,
      }),
    onSuccess: async () => {
      toast.success("Chatbot settings saved");
      await queryClient.invalidateQueries({ queryKey: ["chatbots", brandId] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save chatbot settings",
      ),
  });
  const attach = useMutation({
    mutationFn: (selectedFileId: string) =>
      post(`/api/v2/brands/${brandId}/chatbots/${widgetId}/knowledge`, {
        file_ids: [selectedFileId],
      }),
    onSuccess: async () => {
      setFileId("");
      toast.success("Document queued for indexing");
      await queryClient.invalidateQueries({
        queryKey: ["chatbot-knowledge", brandId, widgetId],
      });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Unable to attach document",
      ),
  });
  const runTest = useMutation({
    mutationFn: () =>
      post<{ data: TestResult }>(
        `/api/v2/brands/${brandId}/chatbots/${widgetId}/test`,
        { question },
      ).then((value) => value.data),
    onSuccess: setTestResult,
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Unable to test the chatbot",
      ),
  });
  const widgetCode = useMemo(
    () =>
      draft
        ? `<script async src="${window.location.origin}/api/v2/public/widget/${draft.public_key}/loader.js"></script>`
        : "",
    [draft],
  );

  async function upload(filesToUpload: FileList | null) {
    if (!filesToUpload?.length) return;
    const form = new FormData();
    let folder = files.data?.find((item) => item.kind === "folder" && item.name === "Chatbot knowledge");
    if (!folder) folder = await post<FileItem>(`/api/brands/${brandId}/files/folder`, { name: "Chatbot knowledge", parent_id: null });
    form.append("parent_id", folder.id);
    for (const file of filesToUpload) form.append("files", file);
    try {
      const created = await api<FileItem[]>(
        `/api/brands/${brandId}/files/upload`,
        { method: "POST", body: form },
      );
      await post(`/api/v2/brands/${brandId}/chatbots/${widgetId}/knowledge`, {
        file_ids: created.map((file) => file.id),
      });
      toast.success("Files uploaded and queued for indexing");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["chatbot-knowledge", brandId, widgetId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["files-for-chatbot", brandId],
        }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to upload knowledge files",
      );
    }
  }

  if (widgets.isLoading)
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          Loading chatbot settings…
        </CardContent>
      </Card>
    );
  if (!draft)
    return (
      <Alert>
        <Bot />
        <AlertTitle>No chat widget is configured</AlertTitle>
        <AlertDescription>
          Create a chat widget through the API before attaching knowledge.
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="grid gap-5">
      {!featureFlags.data?.chat_ai ? <Alert><Bot/><AlertTitle>Knowledge agent feature is off</AlertTitle><AlertDescription>Existing human chat remains available. Enable chat_ai after providers and at least one ready source are configured.</AlertDescription><Button className="mt-3" size="sm" variant="outline" onClick={() => void api(`/api/v2/brands/${brandId}/feature-flags/chat_ai`, { method: "PUT", body: JSON.stringify({ enabled: true }) }).then(() => queryClient.invalidateQueries({ queryKey: ["channel-flags", brandId] }))}>Enable chat_ai</Button></Alert> : null}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-3">
            <div>
              <CardTitle>Embeddable web chat</CardTitle>
              <CardDescription>
                Configure the public widget, its launch origins, and the
                grounded knowledge agent.
              </CardDescription>
            </div>
            {widgets.data && widgets.data.length > 1 ? (
              <Select
                value={widgetId}
                onValueChange={(value) => setWidgetId(String(value))}
              >
                <SelectTrigger className="ms-auto w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {widgets.data.map((widget) => (
                      <SelectItem key={widget.id} value={widget.id}>
                        {widget.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>Widget name</FieldLabel>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel>Allowed origins</FieldLabel>
              <Textarea
                value={origins(draft.allowed_origins).join("\n")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    allowed_origins: event.target.value
                      .split("\n")
                      .map((item) => item.trim()),
                  })
                }
                placeholder="https://www.example.com"
              />
              <FieldDescription>
                Enter one exact browser origin per line. The loader issues a
                short-lived launch token after validation.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Greeting</FieldLabel>
              <Textarea
                value={draft.greeting}
                onChange={(event) =>
                  setDraft({ ...draft, greeting: event.target.value })
                }
              />
            </Field>
            <Field orientation="horizontal">
              <div>
                <FieldLabel>Enable knowledge agent</FieldLabel>
                <FieldDescription>
                  The agent answers only when attached sources provide adequate
                  evidence.
                </FieldDescription>
              </div>
              <Switch
                className="ms-auto"
                checked={Boolean(draft.agent_enabled)}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, agent_enabled: checked })
                }
              />
            </Field>
            <Field>
              <FieldLabel>Agent instructions</FieldLabel>
              <Textarea
                value={draft.agent_instructions ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, agent_instructions: event.target.value })
                }
                placeholder="Tone, terminology, and supported topics…"
              />
            </Field>
            <Field>
              <FieldLabel>Human handoff message</FieldLabel>
              <Textarea
                value={draft.handoff_message}
                onChange={(event) =>
                  setDraft({ ...draft, handoff_message: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel>Minimum retrieval confidence</FieldLabel>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={draft.min_similarity}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    min_similarity: Number(event.target.value),
                  })
                }
              />
              <FieldDescription>
                Lower thresholds answer more often; higher thresholds favor
                human handoff.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save data-icon="inline-start" />
            Save chatbot
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open(`/widget/${draft.public_key}`, "_blank")}
          >
            <ExternalLink data-icon="inline-start" />
            Private preview
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embed code</CardTitle>
          <CardDescription>
            Add this loader to an allowed website. Public visitors never receive
            filenames, excerpts, or retrieval scores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre
            className="overflow-x-auto rounded-lg border bg-slate-950 p-4 text-xs text-slate-100"
            translate="no"
          >
            {widgetCode}
          </pre>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(widgetCode);
              toast.success("Widget code copied");
            }}
          >
            <Copy data-icon="inline-start" />
            Copy snippet
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div>
              <CardTitle>Chatbot knowledge</CardTitle>
              <CardDescription>
                Attach clean Files or upload a new PDF, Office document,
                spreadsheet, text, Markdown, or HTML file.
              </CardDescription>
            </div>
            <div className="ms-auto flex gap-2">
              <Badge variant="secondary">
                {documents.data?.filter((item) => item.status === "ready")
                  .length ?? 0}{" "}
                ready
              </Badge>
              <Badge variant="outline">
                {documents.data?.filter((item) =>
                  ["queued", "processing"].includes(item.status),
                ).length ?? 0}{" "}
                indexing
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={fileId || null}
              onValueChange={(value) => setFileId(String(value))}
            >
              <SelectTrigger className="min-w-0 flex-1">
                <SelectValue placeholder="Select an existing File" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {files.data
                    ?.filter((file) => file.kind === "file")
                    .map((file) => (
                      <SelectItem key={file.id} value={file.id}>
                        {file.name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!fileId || attach.isPending}
              onClick={() => attach.mutate(fileId)}
            >
              <Link2 data-icon="inline-start" />
              Attach File
            </Button>
              <Button variant="outline" onClick={() => uploadInput.current?.click()}>
                <Upload data-icon="inline-start" />
                Upload and attach
              </Button>
              <Input
                ref={uploadInput}
                className="sr-only w-px"
                type="file"
                multiple
                accept=".pdf,.docx,.pptx,.xlsx,.csv,.ods,.txt,.md,.markdown,.html,.htm"
                onChange={(event) => void upload(event.target.files)}
              />
          </div>
          {documents.data?.length ? (
            <div className="grid gap-2">
              {documents.data.map((document) => (
                <div key={document.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <FilePlus2 className="size-4 text-muted-foreground" />
                    <strong
                      className="min-w-0 flex-1 truncate text-sm"
                      translate="no"
                    >
                      {document.filename}
                    </strong>
                    <Badge
                      variant={
                        document.status === "ready"
                          ? "default"
                          : document.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {t(document.status)}
                    </Badge>
                    {document.status === "failed" ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("Retry indexing")}
                        onClick={() =>
                          void post(
                            `/api/v2/brands/${brandId}/chatbots/${widgetId}/knowledge/${document.id}/retry`,
                          ).then(() =>
                            queryClient.invalidateQueries({
                              queryKey: [
                                "chatbot-knowledge",
                                brandId,
                                widgetId,
                              ],
                            }),
                          )
                        }
                      >
                        <RotateCcw />
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("Unlink document")}
                      onClick={() =>
                        void remove(
                          `/api/v2/brands/${brandId}/chatbots/${widgetId}/knowledge/${document.id}`,
                        ).then(() =>
                          queryClient.invalidateQueries({
                            queryKey: ["chatbot-knowledge", brandId, widgetId],
                          }),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {["queued", "processing"].includes(document.status) ? (
                    <Progress className="mt-2" value={document.progress} />
                  ) : null}
                  {document.status === "ready" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("{count} chunks indexed", {
                        count: document.chunk_count,
                      })}
                    </p>
                  ) : null}
                  {document.error_message ? (
                    <p className="mt-1 text-xs text-destructive">
                      {document.error_message}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No knowledge documents are attached yet.
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() =>
              void post(`/api/v2/brands/${brandId}/chatbots/reindex`).then(
                () => {
                  toast.success("Reindex queued");
                  return queryClient.invalidateQueries({
                    queryKey: ["chatbot-knowledge", brandId, widgetId],
                  });
                },
              )
            }
          >
            <RefreshCw data-icon="inline-start" />
            Reindex all
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Private test playground</CardTitle>
          <CardDescription>
            Test the grounded answer and inspect evidence before enabling the
            public agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field>
            <FieldLabel>Question</FieldLabel>
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question covered by the attached documents…"
            />
          </Field>
          <Button
            className="justify-self-start"
            disabled={!question.trim() || runTest.isPending}
            onClick={() => runTest.mutate()}
          >
            <Play data-icon="inline-start" />
            {runTest.isPending ? "Testing…" : "Test answer"}
          </Button>
          {testResult ? (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    testResult.outcome === "answered" ? "default" : "secondary"
                  }
                >
                  {t(testResult.outcome)}
                </Badge>
                {testResult.reason ? (
                  <span className="text-xs text-muted-foreground">
                    {t(testResult.reason)}
                  </span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-sm">{testResult.answer}</p>
              {testResult.evidence.map((evidence) => (
                <div
                  key={evidence.file_id + JSON.stringify(evidence.location)}
                  className="rounded-md border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <strong translate="no">{evidence.filename}</strong>
                    <span className="text-muted-foreground">
                      {location(evidence.location)}
                    </span>
                    <Badge className="ms-auto" variant="outline">
                      {evidence.score.toFixed(3)}
                    </Badge>
                  </div>
                  <p
                    className="mt-2 line-clamp-3 text-xs text-muted-foreground"
                    translate="no"
                  >
                    {evidence.excerpt}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
