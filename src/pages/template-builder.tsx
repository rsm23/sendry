import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Eye,
  FileStack,
  Layers3,
  LoaderCircle,
  Minus,
  Monitor,
  MoreHorizontal,
  PanelRight,
  Plus,
  Redo2,
  Save,
  Settings2,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { get, patch } from "@/lib/api";
import {
  createEmailBlock,
  EMAIL_BLOCK_DEFINITIONS,
  emailBlockId,
  emailDocumentFromTemplate,
  renderEmailDocument,
  renderPlainText,
  type EmailBlock,
  type EmailBlockType,
  type EmailDevice,
  type EmailDocument,
} from "@/lib/email-builder";
import { useI18n } from "@/i18n/context";
import { BlockInspector, VariablePicker } from "@/components/email-builder/block-inspector";
import { EmailCanvas } from "@/components/email-builder/email-canvas";
import { ElementIcon, ElementLibrary } from "@/components/email-builder/element-library";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Template = {
  id: string;
  name: string;
  subject: string;
  plain_text: string;
  html_text: string;
  editor_mode: string;
  editor_data: unknown;
  updated_at: string;
};

type HistoryState = { past: EmailDocument[]; present: EmailDocument; future: EmailDocument[] };
type HistoryAction = { type: "reset" | "update"; document: EmailDocument } | { type: "undo" | "redo" };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "reset") return { past: [], present: action.document, future: [] };
  if (action.type === "update") {
    if (JSON.stringify(state.present) === JSON.stringify(action.document)) return state;
    return { past: [...state.past.slice(-49), state.present], present: action.document, future: [] };
  }
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  const next = state.future[0];
  return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
}

const initialDocument = emailDocumentFromTemplate(null, "");
const frameWidths: Record<EmailDevice, number> = { desktop: 720, tablet: 560, mobile: 360 };

export default function TemplateBuilderPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { brand } = useAuth();
  const { t } = useI18n();
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initialDocument, future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(initialDocument.blocks[1]?.id ?? null);
  const [templateName, setTemplateName] = useState("");
  const [subject, setSubject] = useState("");
  const [device, setDevice] = useState<EmailDevice>(() => matchMedia("(max-width: 1023px)").matches ? "mobile" : "desktop");
  const [previewDevice, setPreviewDevice] = useState<EmailDevice>("desktop");
  const [zoom, setZoom] = useState(100);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"elements" | "layers" | "settings" | null>(null);
  const [draggedType, setDraggedType] = useState<EmailBlockType | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSignature, setSavedSignature] = useState("");
  const loadedId = useRef<string | null>(null);
  const saveInFlight = useRef(false);
  const query = useQuery({
    queryKey: ["templates", brand?.id],
    queryFn: () => get<Template[]>(`/api/brands/${brand?.id}/templates`),
    enabled: !!brand,
  });
  const template = query.data?.find((item) => item.id === templateId);
  const document = history.present;
  const selectedBlock = document.blocks.find((block) => block.id === selectedId) ?? null;
  const selectedLabel = selectedBlock ? EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === selectedBlock.type)?.label ?? selectedBlock.type : null;
  const currentSignature = useMemo(() => JSON.stringify({ templateName, subject, document }), [document, subject, templateName]);
  const dirty = !!loadedId.current && currentSignature !== savedSignature;
  const html = useMemo(() => renderEmailDocument(document), [document]);
  const previewHtml = useMemo(() => renderEmailDocument(document, true), [document]);

  useEffect(() => {
    if (!template || loadedId.current === template.id) return;
    const nextDocument = emailDocumentFromTemplate(template.editor_data, template.html_text);
    dispatch({ type: "reset", document: nextDocument });
    setTemplateName(template.name);
    setSubject(template.subject);
    setSelectedId(nextDocument.blocks[0]?.id ?? null);
    const signature = JSON.stringify({ templateName: template.name, subject: template.subject, document: nextDocument });
    setSavedSignature(signature);
    loadedId.current = template.id;
  }, [template]);

  const saveTemplate = useCallback(async (announce = false) => {
    if (!template || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    const signature = JSON.stringify({ templateName, subject, document });
    try {
      const saved = await patch<Template>(`/api/brands/${brand?.id}/templates/${template.id}`, {
        name: templateName.trim() || "Untitled template",
        subject,
        plain_text: renderPlainText(document),
        html_text: renderEmailDocument(document),
        editor_mode: "blocks",
        editor_data: document,
      });
      setSavedSignature(signature);
      client.setQueryData<Template[]>(["templates", brand?.id], (rows) => rows?.map((row) => row.id === saved.id ? saved : row));
      if (announce) toast.success("Template saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Template could not be saved");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }, [brand?.id, client, document, subject, template, templateName]);

  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => void saveTemplate(false), 1800);
    return () => window.clearTimeout(timer);
  }, [dirty, saveTemplate, saving]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); void saveTemplate(true); }
      if (modifier && event.key.toLowerCase() === "z") { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); }
      if (modifier && event.key.toLowerCase() === "y") { event.preventDefault(); dispatch({ type: "redo" }); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [saveTemplate]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateDocument = (next: EmailDocument) => dispatch({ type: "update", document: next });
  const updateBlock = (next: EmailBlock) => updateDocument({ ...document, blocks: document.blocks.map((block) => block.id === next.id ? next : block) });
  const addBlock = (type: EmailBlockType, index = document.blocks.length) => {
    const block = createEmailBlock(type);
    const blocks = [...document.blocks];
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
    updateDocument({ ...document, blocks });
    setSelectedId(block.id);
    setMobilePanel(null);
  };
  const moveBlock = (id: string, insertionIndex: number) => {
    const from = document.blocks.findIndex((block) => block.id === id);
    if (from < 0) return;
    const blocks = [...document.blocks];
    const [block] = blocks.splice(from, 1);
    const adjusted = from < insertionIndex ? insertionIndex - 1 : insertionIndex;
    blocks.splice(Math.max(0, Math.min(adjusted, blocks.length)), 0, block);
    updateDocument({ ...document, blocks });
  };
  const duplicateBlock = (id: string) => {
    const index = document.blocks.findIndex((block) => block.id === id);
    if (index < 0) return;
    const copy = structuredClone(document.blocks[index]);
    copy.id = emailBlockId();
    const blocks = [...document.blocks];
    blocks.splice(index + 1, 0, copy);
    updateDocument({ ...document, blocks });
    setSelectedId(copy.id);
  };
  const deleteBlock = (id: string) => {
    const index = document.blocks.findIndex((block) => block.id === id);
    const blocks = document.blocks.filter((block) => block.id !== id);
    updateDocument({ ...document, blocks });
    setSelectedId(blocks[Math.min(index, blocks.length - 1)]?.id ?? null);
  };

  if (query.isLoading || !loadedId.current) {
    if (!query.isLoading && query.data && !template) return <div className="grid h-full place-items-center p-6 text-center"><div><FileStack className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-3 text-lg font-semibold">Template not found</h1><p className="mt-1 text-sm text-muted-foreground">It may have been deleted or belongs to another brand.</p><Button className="mt-4" onClick={() => navigate("/templates")}><ArrowLeft data-icon="inline-start" />Back to templates</Button></div></div>;
    return <div className="flex h-full flex-col gap-3 p-4"><Skeleton className="h-12 w-full" /><div className="grid min-h-0 flex-1 grid-cols-[15rem_1fr_18rem] gap-3"><Skeleton /><Skeleton /><Skeleton /></div></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-3">
        <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Back to templates" onClick={() => navigate("/templates")} />}><ArrowLeft /></TooltipTrigger><TooltipContent>Back to templates</TooltipContent></Tooltip>
        <Input className="h-8 min-w-0 max-w-44 border-transparent bg-muted/50 font-medium hover:border-input focus-visible:bg-background sm:max-w-56 2xl:max-w-72" value={templateName} onChange={(event) => setTemplateName(event.target.value)} aria-label="Template name" />
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground 2xl:flex">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : dirty ? <span className="size-2 rounded-full bg-amber-500" /> : <CheckCircle2 className="size-3.5 text-emerald-600" />}{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</span>
        <div className="mx-1 hidden h-6 w-px bg-border 2xl:block" />
        <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" aria-label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })} />}><Undo2 /></TooltipTrigger><TooltipContent>Undo</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" aria-label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: "redo" })} />}><Redo2 /></TooltipTrigger><TooltipContent>Redo</TooltipContent></Tooltip>
        <div className="ms-auto hidden lg:block"><DeviceToggle value={device} onChange={setDevice} /></div>
        <Button variant="outline" size="sm" className="hidden md:inline-flex" aria-label="Preview" onClick={() => setPreviewOpen(true)}><Eye data-icon="inline-start" /><span className="hidden 2xl:inline">Preview</span></Button>
        <Button variant="outline" size="sm" className="hidden 2xl:inline-flex" aria-label="HTML source" onClick={() => setSourceOpen(true)}><Code2 data-icon="inline-start" />HTML</Button>
        <TemplateSettings name={templateName} subject={subject} onNameChange={setTemplateName} onSubjectChange={setSubject} />
        <Button size="sm" aria-label="Save" onClick={() => void saveTemplate(true)} disabled={saving || !dirty}><Save data-icon="inline-start" /><span className="hidden 2xl:inline">Save template</span><span className="sr-only 2xl:hidden">Save</span></Button>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="More template actions" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => setPreviewOpen(true)}><Eye />Preview</DropdownMenuItem><DropdownMenuItem onClick={() => setSourceOpen(true)}><Code2 />HTML source</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </header>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-2 py-2 lg:hidden"><DeviceToggle value={device} onChange={setDevice} /><div className="flex items-center gap-1"><Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })}><Undo2 /></Button><Button variant="ghost" size="sm" onClick={() => setPreviewOpen(true)}><Eye data-icon="inline-start" />Preview</Button></div></div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15.5rem_minmax(20rem,1fr)_18rem] xl:grid-cols-[17rem_minmax(24rem,1fr)_20rem]">
        <aside className="hidden min-h-0 border-e lg:flex"><ElementLibrary onAdd={(type) => addBlock(type)} onDragStateChange={setDraggedType} /></aside>
        <main className="relative flex min-h-0 min-w-0 flex-col">
          <EmailCanvas document={document} selectedId={selectedId} device={device} zoom={zoom} draggedType={draggedType} onSelect={setSelectedId} onAdd={addBlock} onMove={moveBlock} onDuplicate={duplicateBlock} onDelete={deleteBlock} />
          <div className="hidden h-10 shrink-0 items-center justify-between border-t bg-card px-3 text-xs text-muted-foreground sm:flex"><span>{selectedLabel ? `${t("Selected")}: ${t(selectedLabel)}` : "No element selected"}</span><span>{t("Canvas width")}: {Math.min(document.settings.width, device === "desktop" ? 640 : device === "tablet" ? 520 : 320)}px</span><div className="flex items-center gap-1"><Button variant="ghost" size="icon-xs" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(50, value - 10))}><Minus /></Button><span className="w-10 text-center tabular-nums">{zoom}%</span><Button variant="ghost" size="icon-xs" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(140, value + 10))}><Plus /></Button></div></div>
        </main>
        <aside className="hidden min-h-0 border-s bg-card lg:flex"><BlockInspector idPrefix="desktop" block={selectedBlock} document={document} onChangeBlock={updateBlock} onChangeDocument={updateDocument} /></aside>
      </div>
      <nav className="grid h-14 shrink-0 grid-cols-3 border-t bg-card lg:hidden" aria-label="Builder panels">
        <MobilePanelButton label="Elements" icon={PanelRight} active={mobilePanel === "elements"} onClick={() => setMobilePanel("elements")} />
        <MobilePanelButton label="Layers" icon={Layers3} active={mobilePanel === "layers"} onClick={() => setMobilePanel("layers")} />
        <MobilePanelButton label="Settings" icon={Settings2} active={mobilePanel === "settings"} onClick={() => setMobilePanel("settings")} />
      </nav>
      <Sheet open={mobilePanel !== null} onOpenChange={(open) => !open && setMobilePanel(null)}>
        <SheetContent side="bottom" className="max-h-[72svh] gap-0 rounded-t-xl">
          <SheetHeader className="border-b"><SheetTitle>{mobilePanel === "elements" ? "Elements" : mobilePanel === "layers" ? "Layers" : "Settings"}</SheetTitle><SheetDescription>{mobilePanel === "elements" ? "Choose or drag content into your email." : mobilePanel === "layers" ? "Select and reorder the email structure." : "Edit the selected element and email settings."}</SheetDescription></SheetHeader>
          {mobilePanel === "elements" ? <div className="flex min-h-0 flex-1"><ElementLibrary compact onAdd={(type) => addBlock(type)} onDragStateChange={setDraggedType} /></div> : null}
          {mobilePanel === "layers" ? <div className="min-h-0 flex-1 overflow-y-auto"><LayerList document={document} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setMobilePanel(null); }} onMove={moveBlock} onDelete={deleteBlock} /></div> : null}
          {mobilePanel === "settings" ? <div className="flex min-h-0 flex-1"><BlockInspector idPrefix="mobile" block={selectedBlock} document={document} onChangeBlock={updateBlock} onChangeDocument={updateDocument} /></div> : null}
        </SheetContent>
      </Sheet>
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} html={previewHtml} device={previewDevice} onDeviceChange={setPreviewDevice} />
      <SourceDialog open={sourceOpen} onOpenChange={setSourceOpen} html={html} />
    </div>
  );
}

function DeviceToggle({ value, onChange }: { value: EmailDevice; onChange: (value: EmailDevice) => void }) {
  return <ToggleGroup value={[value]} onValueChange={(values) => values[0] && onChange(values[0] as EmailDevice)} variant="outline" spacing={0} size="sm" aria-label="Preview screen"><ToggleGroupItem value="desktop" aria-label="Desktop"><Monitor /><span className="hidden 2xl:inline">Desktop</span></ToggleGroupItem><ToggleGroupItem value="tablet" aria-label="Tablet"><Tablet /><span className="hidden 2xl:inline">Tablet</span></ToggleGroupItem><ToggleGroupItem value="mobile" aria-label="Mobile"><Smartphone /><span className="hidden 2xl:inline">Mobile</span></ToggleGroupItem></ToggleGroup>;
}

function TemplateSettings({ name, subject, onNameChange, onSubjectChange }: { name: string; subject: string; onNameChange: (value: string) => void; onSubjectChange: (value: string) => void }) {
  return <Popover><PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Template settings" />}><Settings2 /></PopoverTrigger><PopoverContent align="end" className="w-80"><div><h2 className="font-medium">Template settings</h2><p className="text-xs text-muted-foreground">Defaults used when this template starts a campaign.</p></div><FieldGroup><Field><FieldLabel htmlFor="builder-template-name">Template name</FieldLabel><Input id="builder-template-name" value={name} onChange={(event) => onNameChange(event.target.value)} /></Field><Field><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="builder-template-subject">Default subject</FieldLabel><VariablePicker onInsert={(token) => onSubjectChange(`${subject}${subject && !/\s$/.test(subject) ? " " : ""}${token}`)} /></div><Input id="builder-template-subject" value={subject} onChange={(event) => onSubjectChange(event.target.value)} placeholder="A useful update for [Name]" /></Field></FieldGroup></PopoverContent></Popover>;
}

function MobilePanelButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof Settings2; active: boolean; onClick: () => void }) {
  return <button type="button" className={`flex flex-col items-center justify-center gap-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? "text-primary" : "text-muted-foreground"}`} onClick={onClick} aria-pressed={active}><Icon className="size-4" /><span>{label}</span></button>;
}

function LayerList({ document, selectedId, onSelect, onMove, onDelete }: { document: EmailDocument; selectedId: string | null; onSelect: (id: string) => void; onMove: (id: string, index: number) => void; onDelete: (id: string) => void }) {
  return <div className="flex flex-col p-2">{document.blocks.map((block, index) => <div key={block.id} className={`flex items-center gap-2 rounded-md border p-2 ${selectedId === block.id ? "border-primary bg-primary/5" : "border-transparent"}`}><button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(block.id)}><span className="grid size-7 shrink-0 place-items-center rounded bg-muted"><ElementIcon type={block.type} className="size-3.5" /></span><span className="truncate text-sm capitalize">{block.type}</span></button><Button variant="ghost" size="icon-xs" aria-label="Move layer up" disabled={index === 0} onClick={() => onMove(block.id, index - 1)}><Undo2 /></Button><Button variant="ghost" size="icon-xs" aria-label="Move layer down" disabled={index === document.blocks.length - 1} onClick={() => onMove(block.id, index + 2)}><Redo2 /></Button><Button variant="ghost" size="icon-xs" aria-label="Delete layer" onClick={() => onDelete(block.id)}><Trash2 /></Button></div>)}</div>;
}

function PreviewDialog({ open, onOpenChange, html, device, onDeviceChange }: { open: boolean; onOpenChange: (open: boolean) => void; html: string; device: EmailDevice; onDeviceChange: (device: EmailDevice) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex h-[92svh] max-w-[95vw] flex-col p-0 sm:max-w-6xl"><DialogHeader className="flex-row items-center justify-between gap-4 border-b px-4 py-3"><div><DialogTitle>Responsive preview</DialogTitle><DialogDescription>Preview variables use example contact data.</DialogDescription></div><div className="pe-8"><DeviceToggle value={device} onChange={onDeviceChange} /></div></DialogHeader><div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/50 p-3 sm:p-6"><div className="h-full max-w-full overflow-hidden border bg-white shadow-sm transition-[width]" style={{ width: `${frameWidths[device]}px` }}><iframe title={`${device} template preview`} srcDoc={html} sandbox="" className="h-full w-full bg-white" /></div></div></DialogContent></Dialog>;
}

function SourceDialog({ open, onOpenChange, html }: { open: boolean; onOpenChange: (open: boolean) => void; html: string }) {
  const copyHtml = async () => { await navigator.clipboard.writeText(html); toast.success("HTML copied"); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = "sendry-template.html";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex h-[88svh] max-w-[95vw] flex-col sm:max-w-5xl"><DialogHeader><DialogTitle>Generated HTML</DialogTitle><DialogDescription>Responsive table HTML is regenerated from the structured design whenever you save.</DialogDescription></DialogHeader><Tabs defaultValue="source" className="flex min-h-0 flex-1 flex-col"><TabsList><TabsTrigger value="source">HTML source</TabsTrigger><TabsTrigger value="rendered">Rendered preview</TabsTrigger></TabsList><TabsContent value="source" className="min-h-0 flex-1"><Textarea readOnly value={html} className="h-full resize-none font-mono text-xs" translate="no" data-i18n-ignore /></TabsContent><TabsContent value="rendered" className="min-h-0 flex-1"><iframe title="Generated HTML preview" srcDoc={html} sandbox="" className="h-full w-full border bg-white" /></TabsContent></Tabs><DialogFooter><Button variant="outline" onClick={() => void copyHtml()}><Copy data-icon="inline-start" />Copy HTML</Button><Button onClick={download}><Download data-icon="inline-start" />Download HTML</Button></DialogFooter></DialogContent></Dialog>;
}
