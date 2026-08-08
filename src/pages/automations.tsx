import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BellRing,
  Bot,
  CalendarDays,
  Clock3,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Smartphone,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, type Brand } from "@/lib/auth";
import { get, patch, post, remove } from "@/lib/api";
import { number, relative } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Automation = {
  id: string;
  list_id: string;
  list_name: string;
  name: string;
  type: "drip" | "annual" | "date";
  date_field_id?: string;
  enabled: boolean;
  sent_count: number;
  step_count: number;
  updated_at: string;
};
type Field = { id: string; name: string; type: string };
type ListItem = { id: string; name: string };
type ListDetail = ListItem & { fields: Field[] };
type Segment = { id: string; name: string; last_count: number };
type Step = {
  id: string;
  subject: string;
  position: number;
  offset_value: number;
  offset_unit: string;
  offset_direction: string;
  enabled: boolean;
  sent_count: number;
  html_text: string;
  plain_text: string;
  opens_tracking: string;
  clicks_tracking: string;
  segment_include: string[];
  segment_exclude: string[];
  channel: "email" | "sms" | "whatsapp" | "push";
  sender_identity_id?: string;
  channel_payload: Record<string, unknown>;
  consent_purpose: "marketing" | "transactional" | "support";
  tracking_policy: Record<string, unknown>;
};
type AutomationDetail = Automation & { steps: Step[] };
type StepReport = {
  id: string;
  delivered: number;
  failed: number;
  unique_opens: number;
  unique_clicks: number;
};
type AutomationReport = {
  steps: StepReport[];
  analysis?: {
    id: string;
    analysis: string;
    score: number;
    source: string;
    updated_at: string;
  };
};

export default function AutomationsPage() {
  const { brand } = useAuth();
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Automation | null>(null);
  const [name, setName] = useState("Welcome series");
  const [type, setType] = useState<Automation["type"]>("drip");
  const [listId, setListId] = useState("");
  const [dateFieldId, setDateFieldId] = useState("");
  const [stepOpen, setStepOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<Step | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const query = useQuery({
    queryKey: ["automations", brand?.id],
    queryFn: () => get<Automation[]>(`/api/brands/${brand?.id}/automations`),
    enabled: !!brand,
  });
  const lists = useQuery({
    queryKey: ["lists", brand?.id],
    queryFn: () => get<ListItem[]>(`/api/brands/${brand?.id}/lists`),
    enabled: !!brand,
  });
  const activeListId = listId || lists.data?.[0]?.id || "";
  const listDetail = useQuery({
    queryKey: ["automation-list", brand?.id, activeListId],
    queryFn: () =>
      get<ListDetail>(`/api/brands/${brand?.id}/lists/${activeListId}`),
    enabled: createOpen && !!activeListId,
  });
  const detail = useQuery({
    queryKey: ["automation", brand?.id, selected?.id],
    queryFn: () =>
      get<AutomationDetail>(
        `/api/brands/${brand?.id}/automations/${selected?.id}`,
      ),
    enabled: !!selected,
  });
  const report = useQuery({
    queryKey: ["automation-report", brand?.id, selected?.id],
    queryFn: () =>
      get<AutomationReport>(
        `/api/brands/${brand?.id}/automations/${selected?.id}/report`,
      ),
    enabled: !!selected,
  });
  const segments = useQuery({
    queryKey: ["automation-segments", brand?.id, selected?.list_id],
    queryFn: () =>
      get<Segment[]>(
        `/api/brands/${brand?.id}/lists/${selected?.list_id}/segments`,
      ),
    enabled: !!selected,
  });
  const dateFields = useMemo(
    () =>
      listDetail.data?.fields.filter((field) => field.type === "date") ?? [],
    [listDetail.data?.fields],
  );

  const create = useMutation({
    mutationFn: () =>
      post<Automation>(`/api/brands/${brand?.id}/automations`, {
        list_id: activeListId,
        name,
        type,
        date_field_id: type === "drip" ? undefined : dateFieldId,
      }),
    onSuccess: async (value) => {
      const result = await query.refetch();
      setCreateOpen(false);
      setSelected(result.data?.find((item) => item.id === value.id) ?? value);
      toast.success("Automation created");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Automation could not be created",
      ),
  });

  useEffect(() => {
    if (!dateFieldId && dateFields[0]) setDateFieldId(dateFields[0].id);
  }, [dateFieldId, dateFields]);

  async function refreshDetail() {
    await Promise.all([
      client.invalidateQueries({
        queryKey: ["automation", brand?.id, selected?.id],
      }),
      client.invalidateQueries({
        queryKey: ["automation-report", brand?.id, selected?.id],
      }),
      client.invalidateQueries({ queryKey: ["automations", brand?.id] }),
    ]);
  }

  async function toggle(item: Automation) {
    await patch(`/api/brands/${brand?.id}/automations/${item.id}`, {
      enabled: !item.enabled,
    });
    const result = await query.refetch();
    setSelected((current) =>
      current?.id === item.id
        ? (result.data?.find((entry) => entry.id === item.id) ?? {
            ...current,
            enabled: !item.enabled,
          })
        : current,
    );
    toast.success(item.enabled ? "Automation paused" : "Automation enabled");
  }

  async function moveStep(step: Step, direction: -1 | 1) {
    const steps = [...(detail.data?.steps ?? [])];
    const index = steps.findIndex((item) => item.id === step.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= steps.length || !selected) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    await post(
      `/api/brands/${brand?.id}/automations/${selected.id}/steps/reorder`,
      { step_ids: steps.map((item) => item.id) },
    );
    await refreshDetail();
  }

  async function analyzeAutomation() {
    if (!selected) return;
    setReportBusy(true);
    try {
      await post(`/api/brands/${brand?.id}/automations/${selected.id}/analyze`);
      await report.refetch();
      toast.success("Automation analysis updated");
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={brand?.name}
        title="Automations"
        description="Drip sequences, annual messages, and one-time date workflows with segment targeting and per-step reporting."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Create automation
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Series" value={number.format(query.data?.length ?? 0)} />
        <Metric
          label="Enabled"
          value={number.format(
            query.data?.filter((item) => item.enabled).length ?? 0,
          )}
        />
        <Metric
          label="Steps"
          value={number.format(
            query.data?.reduce(
              (sum, item) => sum + Number(item.step_count),
              0,
            ) ?? 0,
          )}
        />
        <Metric
          label="Emails sent"
          value={number.format(
            query.data?.reduce(
              (sum, item) => sum + Number(item.sent_count),
              0,
            ) ?? 0,
          )}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {query.data?.map((item) => (
          <Card
            key={item.id}
            className="cursor-pointer hover:border-foreground/25"
            onClick={() => setSelected(item)}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`grid size-10 place-items-center rounded-lg ${item.type === "drip" ? "bg-blue-100 text-blue-700" : item.type === "annual" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                >
                  {item.type === "drip" ? <Workflow /> : <CalendarDays />}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(event) => event.stopPropagation()}
                      />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void toggle(item)}>
                      {item.enabled ? <Pause /> : <Play />}
                      {item.enabled ? "Pause" : "Enable"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={async () => {
                        await remove(
                          `/api/brands/${brand?.id}/automations/${item.id}`,
                        );
                        await query.refetch();
                        if (selected?.id === item.id) setSelected(null);
                      }}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <CardTitle className="mt-3">{item.name}</CardTitle>
              <CardDescription>
                {item.list_name} ·{" "}
                <span className="capitalize">{item.type}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between">
                <div>
                  <p className="metric-number text-2xl">
                    {number.format(item.sent_count)}
                  </p>
                  <p className="text-xs text-muted-foreground">emails sent</p>
                </div>
                <div className="text-right">
                  <StatusBadge status={item.enabled ? "active" : "stopped"} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.step_count} steps
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!query.data?.length && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="grid min-h-48 place-items-center text-center">
              <div>
                <Workflow className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="font-medium">No automations yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a sequence that reacts to sign-up or profile dates.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create automation</DialogTitle>
            <DialogDescription>
              Choose an audience and trigger model. Date workflows use a date
              custom field.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1.5"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label>Audience</Label>
              <Select
                value={activeListId}
                onValueChange={(value) => {
                  setListId(String(value));
                  setDateFieldId("");
                }}
              >
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue>
                    {lists.data?.find((list) => list.id === activeListId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {lists.data?.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "drip", label: "Drip", icon: Workflow },
                  { id: "annual", label: "Annual", icon: CalendarDays },
                  { id: "date", label: "On date", icon: Clock3 },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setType(option.id)}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-sm ${type === option.id ? "border-primary bg-primary/5 text-primary" : ""}`}
                >
                  <option.icon className="size-5" />
                  {option.label}
                </button>
              ))}
            </div>
            {type !== "drip" && (
              <div>
                <Label>Date field</Label>
                <Select
                  value={dateFieldId}
                  onValueChange={(value) => setDateFieldId(String(value))}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Choose a date field">
                      {
                        dateFields.find((field) => field.id === dateFieldId)
                          ?.name
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {dateFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!dateFields.length && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    Add a date custom field to this audience first.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={
                !name.trim() ||
                !activeListId ||
                (type !== "drip" && !dateFieldId)
              }
            >
              <Plus />
              Create automation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-3xl"
        >
          <SheetHeader>
            <SheetTitle>{selected?.name}</SheetTitle>
            <SheetDescription>
              {selected?.list_name} · {selected?.type} automation
            </SheetDescription>
          </SheetHeader>
          <div className="p-5">
            <div className="mb-5 flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Series status</p>
                <p className="text-xs text-muted-foreground">
                  Updated {relative(selected?.updated_at)}
                </p>
              </div>
              {selected && (
                <Button
                  variant={selected.enabled ? "outline" : "default"}
                  onClick={() => void toggle(selected)}
                >
                  {selected.enabled ? <Pause /> : <Play />}
                  {selected.enabled ? "Pause" : "Enable"}
                </Button>
              )}
            </div>
            <div className="mb-5 rounded-lg border bg-primary/3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" />
                    AI performance analysis
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Uses step delivery, opens, clicks, and failures to
                    prioritize improvements.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reportBusy}
                  onClick={() => void analyzeAutomation()}
                >
                  <Bot className={reportBusy ? "animate-pulse" : ""} />
                  {report.data?.analysis ? "Re-analyze" : "Analyze"}
                </Button>
              </div>
              {report.data?.analysis && (
                <div className="mt-4 border-t pt-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge>{report.data.analysis.score}/100</Badge>
                    <span className="text-xs text-muted-foreground">
                      {report.data.analysis.source}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">
                    {report.data.analysis.analysis}
                  </p>
                </div>
              )}
            </div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Mixed-channel steps</h3>
                <p className="text-xs text-muted-foreground">
                  Drag-free controls keep ordering keyboard accessible.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setEditingStep(null);
                  setStepOpen(true);
                }}
              >
                <Plus />
                Add step
              </Button>
            </div>
            <div className="data-grid">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Send</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>Opens</TableHead>
                    <TableHead>Clicks</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.data?.steps.map((step, index) => {
                    const stats = report.data?.steps.find(
                      (item) => item.id === step.id,
                    );
                    return (
                      <TableRow key={step.id}>
                        <TableCell className="text-xs capitalize">
                          {step.offset_value === 0
                            ? "On trigger"
                            : `${step.offset_value} ${step.offset_unit} ${step.offset_direction}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{step.channel === "sms" ? <Smartphone/> : step.channel === "whatsapp" ? <MessageCircle/> : step.channel === "push" ? <BellRing/> : <Mail/>}{step.channel}</Badge>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{step.subject}</p>
                          {(step.segment_include.length > 0 ||
                            step.segment_exclude.length > 0) && (
                            <Badge className="mt-1" variant="outline">
                              Segmented
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {number.format(
                            Number(stats?.delivered ?? step.sent_count),
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {number.format(Number(stats?.unique_opens ?? 0))}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {number.format(Number(stats?.unique_clicks ?? 0))}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={step.enabled}
                            onCheckedChange={async (enabled) => {
                              await patch(
                                `/api/brands/${brand?.id}/automations/${selected?.id}/steps/${step.id}`,
                                { enabled: Boolean(enabled) },
                              );
                              await refreshDetail();
                            }}
                            aria-label={`Enable ${step.subject}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={index === 0}
                              onClick={() => void moveStep(step, -1)}
                              aria-label="Move up"
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={
                                index === (detail.data?.steps.length ?? 0) - 1
                              }
                              onClick={() => void moveStep(step, 1)}
                              aria-label="Move down"
                            >
                              <ArrowDown />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button variant="ghost" size="icon-sm" />
                                }
                              >
                                <MoreHorizontal />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingStep(step);
                                    setStepOpen(true);
                                  }}
                                >
                                  <Pencil />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={async () => {
                                    await remove(
                                      `/api/brands/${brand?.id}/automations/${selected?.id}/steps/${step.id}`,
                                    );
                                    await refreshDetail();
                                  }}
                                >
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {selected && (
        <StepDialog
          open={stepOpen}
          onOpenChange={setStepOpen}
          brand={brand}
          automation={selected}
          segments={segments.data ?? []}
          initial={editingStep}
          onSave={async (value) => {
            if (editingStep)
              await patch(
                `/api/brands/${brand?.id}/automations/${selected.id}/steps/${editingStep.id}`,
                value,
              );
            else
              await post(
                `/api/brands/${brand?.id}/automations/${selected.id}/steps`,
                value,
              );
            setStepOpen(false);
            setEditingStep(null);
            await refreshDetail();
            toast.success(
              editingStep
                ? "Automation step updated"
                : "Automation step added",
            );
          }}
        />
      )}
    </>
  );
}

function StepDialog({
  open,
  onOpenChange,
  brand,
  automation,
  segments,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  brand: Brand | null;
  automation: Automation;
  segments: Segment[];
  initial: Step | null;
  onSave: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [subject, setSubject] = useState("Welcome to our community");
  const [offset, setOffset] = useState(0);
  const [unit, setUnit] = useState("days");
  const [direction, setDirection] = useState("after");
  const [html, setHtml] = useState(
    "<h1>Welcome, [Name]</h1><p>Here is what to do next.</p><p>[unsubscribe]</p>",
  );
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [opens, setOpens] = useState("identified");
  const [clicks, setClicks] = useState("identified");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTask, setAiTask] = useState("");
  const [channel, setChannel] = useState<Step["channel"]>("email");
  const [purpose, setPurpose] = useState<Step["consent_purpose"]>("marketing");
  const [messageBody, setMessageBody] = useState("");
  useEffect(() => {
    if (!open) return;
    setSubject(initial?.subject ?? "Welcome to our community");
    setOffset(initial?.offset_value ?? 0);
    setUnit(initial?.offset_unit ?? "days");
    setDirection(initial?.offset_direction ?? "after");
    setHtml(
      initial?.html_text ??
        "<h1>Welcome, [Name]</h1><p>Here is what to do next.</p><p>[unsubscribe]</p>",
    );
    setInclude(initial?.segment_include ?? []);
    setExclude(initial?.segment_exclude ?? []);
    setOpens(initial?.opens_tracking ?? "identified");
    setClicks(initial?.clicks_tracking ?? "identified");
    setChannel(initial?.channel ?? "email");
    setPurpose(initial?.consent_purpose ?? "marketing");
    const payload = initial?.channel_payload ?? {};
    setMessageBody(String(payload.body ?? payload.text ?? payload.title ?? ""));
    setAiTask(
      initial
        ? `Improve this email in the ${automation.name} series.`
        : `Create the next email in the ${automation.name} series for ${automation.list_name}.`,
    );
  }, [open, initial, automation.name, automation.list_name]);
  const toggle = (
    values: string[],
    setValues: (value: string[]) => void,
    id: string,
    checked: boolean,
  ) =>
    setValues(
      checked
        ? [...new Set([...values, id])]
        : values.filter((value) => value !== id),
    );
  async function generateSubject() {
    setAiBusy(true);
    try {
      const result = await post<{ subject: string }>(
        `/api/brands/${brand?.id}/ai/subject`,
        { content: html, current: subject, mode: "concise" },
      );
      setSubject(result.subject);
      toast.success("Subject suggestion applied");
    } finally {
      setAiBusy(false);
    }
  }
  async function generateEmailDraft() {
    setAiBusy(true);
    try {
      const result = await post<{ subject: string; html: string }>(
        `/api/brands/${brand?.id}/ai/email`,
        {
          task: aiTask,
          design:
            "Responsive, concise email that fits the surrounding automated series.",
          requirements:
            "Preserve personalization tags and include [unsubscribe].",
        },
      );
      setSubject(result.subject);
      setHtml(result.html);
      toast.success("Automation email generated");
    } finally {
      setAiBusy(false);
    }
  }
  async function improveEmailDraft() {
    setAiBusy(true);
    try {
      const result = await post<{ content: string }>(
        `/api/brands/${brand?.id}/ai/improve`,
        {
          content: html,
          instruction:
            aiTask ||
            "Improve clarity, hierarchy and conversion while preserving links and facts.",
        },
      );
      setHtml(result.content);
      toast.success("Automation email improved");
    } finally {
      setAiBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit" : "Add"} automation step</DialogTitle>
          <DialogDescription>
            Choose a channel for this step, then set timing, consent purpose,
            content, tracking, and audience exclusions.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Offset</Label>
            <Input
              type="number"
              min={0}
              className="mt-1.5"
              value={offset}
              onChange={(event) => setOffset(Number(event.target.value))}
            />
          </div>
          <div>
            <Label>Unit</Label>
            <Select
              value={unit}
              onValueChange={(value) => setUnit(String(value))}
            >
              <SelectTrigger className="mt-1.5 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["minutes", "hours", "days", "weeks", "months"].map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Direction</Label>
            <Select
              value={direction}
              onValueChange={(value) => setDirection(String(value))}
            >
              <SelectTrigger className="mt-1.5 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="after">After</SelectItem>
                {automation.type !== "drip" && (
                  <SelectItem value="before">Before</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Channel</Label><Select value={channel} onValueChange={(value) => setChannel(String(value) as Step["channel"])}><SelectTrigger className="mt-1.5 w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="sms">SMS</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem><SelectItem value="push">Push</SelectItem></SelectContent></Select></div>
          <div><Label>Consent purpose</Label><Select value={purpose} onValueChange={(value) => setPurpose(String(value) as Step["consent_purpose"])}><SelectTrigger className="mt-1.5 w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="marketing">Marketing</SelectItem><SelectItem value="transactional">Transactional</SelectItem><SelectItem value="support">Support</SelectItem></SelectContent></Select></div>
        </div>
        {channel === "email" && <div className="rounded-lg border bg-primary/3 p-3">
          <Label>AI draft brief</Label>
          <Textarea
            rows={3}
            className="mt-1.5"
            value={aiTask}
            onChange={(event) => setAiTask(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void generateEmailDraft()}
              disabled={aiBusy || !aiTask.trim()}
            >
              <Sparkles className={aiBusy ? "animate-pulse" : ""} />
              Generate email
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void improveEmailDraft()}
              disabled={aiBusy || !html.trim()}
            >
              <Bot />
              Improve current
            </Button>
          </div>
        </div>}
        <div>
          <Label>{channel === "email" ? "Subject" : "Step name"}</Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
            {channel === "email" && <Button
              variant="outline"
              size="icon"
              onClick={() => void generateSubject()}
              disabled={aiBusy}
              aria-label="Generate subject"
            >
              <Bot className={aiBusy ? "animate-pulse" : ""} />
            </Button>}
          </div>
        </div>
        {channel === "email" ? <div>
          <Label>HTML content</Label>
          <Textarea
            rows={9}
            className="mt-1.5 font-mono text-xs"
            value={html}
            onChange={(event) => setHtml(event.target.value)}
          />
        </div> : <div><Label>{channel === "push" ? "Notification body" : "Message body"}</Label><Textarea rows={6} className="mt-1.5" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder={channel === "whatsapp" ? "Use an approved template outside the service window." : `Write the ${channel} message…`}/><p className="mt-1 text-xs text-muted-foreground">The selected sender and consent are re-checked when the step is queued.</p></div>}
        {segments.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SegmentChecks
              label="Only these segments"
              segments={segments}
              values={include}
              onChange={(id, checked) =>
                toggle(include, setInclude, id, checked)
              }
            />
            <SegmentChecks
              label="Exclude these segments"
              segments={segments}
              values={exclude}
              onChange={(id, checked) =>
                toggle(exclude, setExclude, id, checked)
              }
            />
          </div>
        )}
        {channel === "email" && <div className="grid gap-3 sm:grid-cols-2">
          <TrackingSelect
            label="Open tracking"
            value={opens}
            onChange={setOpens}
          />
          <TrackingSelect
            label="Click tracking"
            value={clicks}
            onChange={setClicks}
          />
        </div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              void onSave({
                offset_value: offset,
                offset_unit: unit,
                offset_direction: direction,
                subject,
                from_name: brand?.from_name,
                from_email: brand?.from_email,
                reply_to: brand?.reply_to,
                plain_text: html.replace(/<[^>]+>/g, " "),
                html_text: html,
                editor_mode: "blocks",
                segment_include: include,
                segment_exclude: exclude,
                opens_tracking: opens,
                clicks_tracking: clicks,
                channel,
                sender_identity_id: initial?.sender_identity_id ?? null,
                channel_payload: channel === "email" ? { channel: "email", subject, html, text: html.replace(/<[^>]+>/g, " "), attachments: [] } : channel === "push" ? { channel: "push", title: subject, body: messageBody, data: {} } : { channel, body: messageBody, media: [], ...(channel === "sms" ? { shorten_links: true } : { buttons: [] }) },
                consent_purpose: purpose,
                tracking_policy: { opens: channel === "email" && opens !== "off", clicks: clicks !== "off" },
              })
            }
          >
            <Sparkles />
            {initial ? "Save step" : "Add step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SegmentChecks({
  label,
  segments,
  values,
  onChange,
}: {
  label: string;
  segments: Segment[];
  values: string[];
  onChange: (id: string, checked: boolean) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 max-h-36 space-y-2 overflow-y-auto rounded-lg border p-3">
        {segments.map((segment) => (
          <label key={segment.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={values.includes(segment.id)}
              onCheckedChange={(checked) =>
                onChange(segment.id, Boolean(checked))
              }
            />
            <span className="flex-1">{segment.name}</span>
            <span className="text-xs text-muted-foreground">
              {number.format(segment.last_count)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TrackingSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger className="mt-1.5 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["identified", "anonymous", "off"].map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="metric-number mt-2 text-2xl">{value}</p>
      </CardContent>
    </Card>
  );
}
