import { ArrowDown, ArrowUp, Copy, GripVertical, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/context";
import { EMAIL_BLOCK_DEFINITIONS, renderEmailBlock, type EmailBlockType, type EmailDevice, type EmailDocument } from "@/lib/email-builder";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const deviceWidths: Record<EmailDevice, number> = { desktop: 640, tablet: 520, mobile: 320 };

export function EmailCanvas({ document, selectedId, device, zoom, onSelect, onAdd, onMove, onDuplicate, onDelete }: {
  document: EmailDocument;
  selectedId: string | null;
  device: EmailDevice;
  zoom: number;
  onSelect: (id: string | null) => void;
  onAdd: (type: EmailBlockType, index: number) => void;
  onMove: (id: string, index: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const handleDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-sendry-block-type") as EmailBlockType;
    const blockId = event.dataTransfer.getData("application/x-sendry-block-id");
    if (type) onAdd(type, index);
    else if (blockId) onMove(blockId, index);
  };
  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/45 p-4 sm:p-6" onClick={() => onSelect(null)}>
      <div
        className="email-builder-canvas h-fit min-h-[32rem] shrink-0 border bg-white shadow-sm transition-[width] duration-200"
        style={{ width: `${Math.min(document.settings.width, deviceWidths[device])}px`, zoom: zoom / 100, backgroundColor: document.settings.contentBackgroundColor }}
        data-device={device}
        aria-label={`${device} email canvas`}
      >
        <DropZone index={0} onDrop={handleDrop} />
        {document.blocks.map((block, index) => {
          const selected = selectedId === block.id;
          const definition = EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === block.type);
          return (
            <div key={block.id}>
              <div
                className={`group relative outline-none transition-shadow ${selected ? "z-10 ring-2 ring-inset ring-primary" : "hover:ring-1 hover:ring-inset hover:ring-primary/50"}`}
                role="button"
                tabIndex={0}
                aria-label={`${t(definition?.label ?? block.type)} ${t("element")}`}
                aria-pressed={selected}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-sendry-block-id", block.id);
                }}
                onClick={(event) => { event.stopPropagation(); onSelect(block.id); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(block.id); }
                  if ((event.key === "Delete" || event.key === "Backspace") && selected) onDelete(block.id);
                }}
              >
                <div className="pointer-events-none" translate="no" data-i18n-ignore>
                  {block.type === "html" ? <div className="m-5 rounded-md border border-dashed bg-muted/40 p-5 font-mono text-xs text-muted-foreground">Custom HTML<br />{block.content.html.slice(0, 140)}</div> : <table role="presentation" className="w-full border-collapse"><tbody dangerouslySetInnerHTML={{ __html: renderEmailBlock(block, true) }} /></table>}
                </div>
                <div className={`absolute -top-8 end-2 items-center rounded-md bg-primary p-0.5 text-primary-foreground shadow-md ${selected ? "flex" : "hidden group-focus-within:flex group-hover:flex"}`}>
                  <Tooltip><TooltipTrigger render={<Button type="button" size="icon-xs" variant="ghost" className="cursor-grab text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Drag element" />}><GripVertical /></TooltipTrigger><TooltipContent>Drag element</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger render={<Button type="button" size="icon-xs" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Move element up" disabled={index === 0} onClick={(event) => { event.stopPropagation(); onMove(block.id, index - 1); }} />}><ArrowUp /></TooltipTrigger><TooltipContent>Move up</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger render={<Button type="button" size="icon-xs" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Move element down" disabled={index === document.blocks.length - 1} onClick={(event) => { event.stopPropagation(); onMove(block.id, index + 2); }} />}><ArrowDown /></TooltipTrigger><TooltipContent>Move down</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger render={<Button type="button" size="icon-xs" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Duplicate element" onClick={(event) => { event.stopPropagation(); onDuplicate(block.id); }} />}><Copy /></TooltipTrigger><TooltipContent>Duplicate</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger render={<Button type="button" size="icon-xs" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Delete element" onClick={(event) => { event.stopPropagation(); onDelete(block.id); }} />}><Trash2 /></TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
                </div>
                <span className={`absolute start-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[0.6rem] font-medium text-primary-foreground ${selected ? "block" : "hidden group-focus-within:block group-hover:block"}`}>{t(definition?.label ?? block.type)}</span>
              </div>
              <DropZone index={index + 1} onDrop={handleDrop} />
            </div>
          );
        })}
        {!document.blocks.length ? <div className="grid min-h-80 place-items-center p-8 text-center text-sm text-muted-foreground"><div><p className="font-medium text-foreground">Start with an element</p><p className="mt-1">Drag an element here or choose one from the library.</p></div></div> : null}
      </div>
    </div>
  );
}

function DropZone({ index, onDrop }: { index: number; onDrop: (event: React.DragEvent, index: number) => void }) {
  return <div className="group/drop relative h-3" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-sendry-block-type") ? "copy" : "move"; }} onDrop={(event) => onDrop(event, index)}><div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover/drop:bg-primary group-[.dragging]/drop:bg-primary" /><span className="pointer-events-none absolute start-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary px-2 py-0.5 text-[0.6rem] text-primary-foreground group-hover/drop:block">Drop content here</span></div>;
}
