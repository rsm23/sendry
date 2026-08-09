import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Copy, GripVertical, Layers3, Monitor, Settings2, Smartphone, Sparkles, Tablet, Trash2 } from "lucide-react";
import {
  createEmailBlock,
  EMAIL_BLOCK_DEFINITIONS,
  emailBlockId,
  renderEmailDocument,
  type EmailBlock,
  type EmailBlockType,
  type EmailDevice,
  type EmailDocument,
} from "@/lib/email-builder";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/context";
import { BlockInspector } from "@/components/email-builder/block-inspector";
import { EmailCanvas } from "@/components/email-builder/email-canvas";
import { ElementIcon, ElementLibrary } from "@/components/email-builder/element-library";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type CampaignEditorMode = "blocks" | "visual" | "html";

type CampaignEmailDesignerProps = {
  device: EmailDevice;
  document: EmailDocument;
  fromEmail: string;
  fromName: string;
  html: string;
  mode: CampaignEditorMode;
  previewOpen: boolean;
  subject: string;
  analysis: { score: number; analysis: string } | null;
  onAnalyze: () => void;
  onChangeDevice: (device: EmailDevice) => void;
  onChangeDocument: (document: EmailDocument) => void;
  onChangeHtml: (html: string) => void;
  onChangeMode: (mode: CampaignEditorMode) => void;
  onImprove: () => void;
  onPreviewOpenChange: (open: boolean) => void;
};

const frameWidths: Record<EmailDevice, number> = { desktop: 720, tablet: 560, mobile: 360 };
const canvasWidths: Record<EmailDevice, string> = { desktop: "max-w-2xl", tablet: "max-w-[560px]", mobile: "max-w-[390px]" };

export function CampaignEmailDesigner({ device, document, fromEmail, fromName, html, mode, previewOpen, subject, analysis, onAnalyze, onChangeDevice, onChangeDocument, onChangeHtml, onChangeMode, onImprove, onPreviewOpenChange }: CampaignEmailDesignerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(document.blocks[0]?.id ?? null);
  const [draggedType, setDraggedType] = useState<EmailBlockType | null>(null);
  const selectedBlock = document.blocks.find((block) => block.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && document.blocks.some((block) => block.id === selectedId)) return;
    setSelectedId(document.blocks[0]?.id ?? null);
  }, [document.blocks, selectedId]);

  const addBlock = (type: EmailBlockType, index = document.blocks.length) => {
    const block = createEmailBlock(type);
    const blocks = [...document.blocks];
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
    onChangeDocument({ ...document, blocks });
    setSelectedId(block.id);
  };
  const moveBlock = (id: string, insertionIndex: number) => {
    const from = document.blocks.findIndex((block) => block.id === id);
    if (from < 0) return;
    const blocks = [...document.blocks];
    const [block] = blocks.splice(from, 1);
    const adjusted = from < insertionIndex ? insertionIndex - 1 : insertionIndex;
    blocks.splice(Math.max(0, Math.min(adjusted, blocks.length)), 0, block);
    onChangeDocument({ ...document, blocks });
  };
  const duplicateBlock = (id: string) => {
    const index = document.blocks.findIndex((block) => block.id === id);
    if (index < 0) return;
    const copy = structuredClone(document.blocks[index]);
    copy.id = emailBlockId();
    const blocks = [...document.blocks];
    blocks.splice(index + 1, 0, copy);
    onChangeDocument({ ...document, blocks });
    setSelectedId(copy.id);
  };
  const deleteBlock = (id: string) => {
    const index = document.blocks.findIndex((block) => block.id === id);
    const blocks = document.blocks.filter((block) => block.id !== id);
    onChangeDocument({ ...document, blocks });
    setSelectedId(blocks[Math.min(index, blocks.length - 1)]?.id ?? null);
  };
  const updateBlock = (next: EmailBlock) => onChangeDocument({ ...document, blocks: document.blocks.map((block) => block.id === next.id ? next : block) });

  return (
    <>
      <section className="flex min-h-[44rem] min-w-0 flex-col bg-muted/35">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b bg-background px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">Email editor</span>
            <Tabs value={mode} onValueChange={(value) => onChangeMode(value as CampaignEditorMode)}>
              <TabsList className="h-8">
                <TabsTrigger value="blocks">Blocks</TabsTrigger>
                <TabsTrigger value="visual">Visual</TabsTrigger>
                <TabsTrigger value="html">HTML</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <DeviceToggle value={device} onChange={onChangeDevice} />
        </div>
        {mode === "blocks" ? (
          <EmailCanvas document={document} selectedId={selectedId} device={device} zoom={100} draggedType={draggedType} onSelect={setSelectedId} onAdd={addBlock} onMove={moveBlock} onDuplicate={duplicateBlock} onDelete={deleteBlock} />
        ) : (
          <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4 sm:p-6">
            <div className={cn("w-full overflow-hidden border bg-white shadow-sm transition-[max-width]", canvasWidths[device])}>
              <EmailEnvelope subject={subject} fromName={fromName} fromEmail={fromEmail} />
              {mode === "html" ? (
                <Textarea aria-label="HTML source" className="min-h-[670px] resize-none rounded-none border-0 font-mono text-xs text-slate-900" value={html} onChange={(event) => onChangeHtml(event.target.value)} translate="no" data-i18n-ignore />
              ) : (
                <VisualEmailEditor html={html} onChange={onChangeHtml} />
              )}
            </div>
          </div>
        )}
      </section>
      <aside className="min-h-0 min-w-0 max-w-full overflow-hidden border-s bg-card">
        <Tabs defaultValue="elements" className="flex min-h-[44rem] w-full min-w-0 max-w-full flex-col overflow-hidden">
          <TabsList variant="line" className="mx-3 mt-2 max-w-[calc(100%-1.5rem)]">
            <TabsTrigger value="elements" className="flex-1">Elements</TabsTrigger>
            <TabsTrigger value="layers" className="flex-1">Layers</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger>
            <TabsTrigger value="tools" className="flex-1">Tools</TabsTrigger>
          </TabsList>
          <TabsContent value="elements" className="flex min-h-0 flex-1"><ElementLibrary compact onAdd={addBlock} onDragStateChange={setDraggedType} /></TabsContent>
          <TabsContent value="layers" className="min-h-0 flex-1 overflow-y-auto"><CampaignLayerList document={document} selectedId={selectedId} onSelect={setSelectedId} onMove={moveBlock} onDuplicate={duplicateBlock} onDelete={deleteBlock} /></TabsContent>
          <TabsContent value="settings" className="flex min-h-0 flex-1"><BlockInspector idPrefix="campaign" block={selectedBlock} document={document} onChangeBlock={updateBlock} onChangeDocument={onChangeDocument} /></TabsContent>
          <TabsContent value="tools" className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              <div><h2 className="text-sm font-semibold">Content tools</h2><p className="mt-1 text-xs text-muted-foreground">Improve the draft or review its quality without leaving the designer.</p></div>
              <Button variant="outline" className="w-full justify-start" onClick={onImprove}><Sparkles /> Improve content</Button>
              <Button variant="outline" className="w-full justify-start" onClick={onAnalyze}><Bot /> Analyze quality</Button>
              {analysis ? <Alert><Settings2 /><AlertTitle>Quality score: {analysis.score}/100</AlertTitle><AlertDescription>{analysis.analysis}</AlertDescription></Alert> : null}
            </div>
          </TabsContent>
        </Tabs>
      </aside>
      <CampaignPreviewDialog open={previewOpen} onOpenChange={onPreviewOpenChange} html={mode === "blocks" ? renderEmailDocument(document, true) : html} device={device} onChangeDevice={onChangeDevice} />
    </>
  );
}

function EmailEnvelope({ subject, fromName, fromEmail }: { subject: string; fromName: string; fromEmail: string }) {
  return <div className="border-b px-5 py-3 text-xs text-slate-500"><strong className="text-slate-800">{subject || "Campaign subject"}</strong><br /><span translate="no">{fromName} &lt;{fromEmail}&gt;</span></div>;
}

function bodyFromHtml(html: string) {
  return html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

function replaceBody(html: string, body: string) {
  return /<body[^>]*>[\s\S]*?<\/body>/i.test(html) ? html.replace(/(<body[^>]*>)[\s\S]*?(<\/body>)/i, `$1${body}$2`) : body;
}

function safeVisualBody(html: string) {
  const template = window.document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,style,link,meta,base,iframe,object,embed,svg,math,form,input,button,textarea,select").forEach((element) => element.remove());
  template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction" || name === "xlink:href") element.removeAttribute(attribute.name);
      if ((name === "href" || name === "src") && /^(?:javascript|vbscript|data):/i.test(value)) {
        const safeDataImage = element.tagName === "IMG" && /^data:image\/(?:gif|jpe?g|png|webp);base64,/i.test(value);
        if (!safeDataImage) element.removeAttribute(attribute.name);
      }
      if (name === "style" && /(?:url\s*\(|expression\s*\(|javascript\s*:|data\s*:|-moz-binding|behavior\s*:)/i.test(value)) element.removeAttribute(attribute.name);
    }
  });
  return template.innerHTML;
}

function VisualEmailEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const body = safeVisualBody(bodyFromHtml(html));

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor || editor.innerHTML === body) return;
    editor.innerHTML = body;
  }, [body]);

  const commit = (element: HTMLDivElement) => onChange(replaceBody(html, element.innerHTML));
  return <div ref={editorRef} className="min-h-[670px] p-5 text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" contentEditable suppressContentEditableWarning onInput={(event) => commit(event.currentTarget)} onBlur={(event) => commit(event.currentTarget)} aria-label="Visual email content" translate="no" />;
}

function DeviceToggle({ value, onChange }: { value: EmailDevice; onChange: (device: EmailDevice) => void }) {
  return (
    <ToggleGroup value={[value]} onValueChange={(values) => values[0] && onChange(values[0] as EmailDevice)} variant="outline" spacing={0} size="sm" aria-label="Preview screen">
      <ToggleGroupItem value="desktop" aria-label="Desktop preview"><Monitor /></ToggleGroupItem>
      <ToggleGroupItem value="tablet" aria-label="Tablet preview"><Tablet /></ToggleGroupItem>
      <ToggleGroupItem value="mobile" aria-label="Mobile preview"><Smartphone /></ToggleGroupItem>
    </ToggleGroup>
  );
}

function CampaignLayerList({ document, selectedId, onSelect, onMove, onDuplicate, onDelete }: { document: EmailDocument; selectedId: string | null; onSelect: (id: string) => void; onMove: (id: string, index: number) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1 p-2" aria-label="Email layers">
      {document.blocks.map((block, index) => {
        const definition = EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === block.type);
        return (
          <div key={block.id} className={cn("flex items-center gap-1 rounded-md border p-1.5", selectedId === block.id ? "border-primary bg-primary/5" : "border-transparent")} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-sendry-block-id", block.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("application/x-sendry-block-id"); if (id) onMove(id, index); }}>
            <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-sm p-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(block.id)} aria-pressed={selectedId === block.id}>
              <ElementIcon type={block.type} className="size-3.5 shrink-0" />
              <span className="truncate text-xs">{t(definition?.label ?? block.type)}</span>
            </button>
            <Button variant="ghost" size="icon-xs" aria-label="Move layer up" disabled={index === 0} onClick={() => onMove(block.id, index - 1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-xs" aria-label="Move layer down" disabled={index === document.blocks.length - 1} onClick={() => onMove(block.id, index + 2)}><ArrowDown /></Button>
            <Button variant="ghost" size="icon-xs" aria-label="Duplicate layer" onClick={() => onDuplicate(block.id)}><Copy /></Button>
            <Button variant="ghost" size="icon-xs" aria-label="Delete layer" onClick={() => onDelete(block.id)}><Trash2 /></Button>
          </div>
        );
      })}
      {!document.blocks.length ? <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground"><Layers3 className="size-5" /><span>No layers yet</span></div> : null}
    </div>
  );
}

function CampaignPreviewDialog({ open, onOpenChange, html, device, onChangeDevice }: { open: boolean; onOpenChange: (open: boolean) => void; html: string; device: EmailDevice; onChangeDevice: (device: EmailDevice) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92svh] max-w-[95vw] flex-col p-0 sm:max-w-6xl">
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b px-4 py-3">
          <div><DialogTitle>Responsive preview</DialogTitle><DialogDescription>Check the campaign at desktop, tablet, and mobile widths.</DialogDescription></div>
          <div className="pe-8"><DeviceToggle value={device} onChange={onChangeDevice} /></div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/50 p-3 sm:p-6">
          <div className="h-full max-w-full overflow-hidden border bg-white shadow-sm transition-[width]" style={{ width: `${frameWidths[device]}px` }}>
            <iframe title={`${device} campaign preview`} srcDoc={html} sandbox="" className="h-full w-full bg-white" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
