import { useMemo, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Braces, Search } from "lucide-react";
import { useI18n } from "@/i18n/context";
import { EMAIL_BLOCK_DEFINITIONS, EMAIL_VARIABLES, type EmailBlock, type EmailDevice, type EmailDocument } from "@/lib/email-builder";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ContentField = { key: string; label: string; multiline?: boolean; variable?: boolean; type?: "number" | "url" };

const contentFields: Record<EmailBlock["type"], ContentField[]> = {
  layout: [{ key: "heading", label: "Heading", variable: true }, { key: "text", label: "Text", multiline: true, variable: true }],
  heading: [{ key: "text", label: "Heading", multiline: true, variable: true }],
  text: [{ key: "text", label: "Text", multiline: true, variable: true }],
  image: [{ key: "src", label: "Image URL", type: "url" }, { key: "alt", label: "Alternative text", variable: true }, { key: "link", label: "Link URL", type: "url" }],
  button: [{ key: "label", label: "Button label", variable: true }, { key: "url", label: "Link URL", type: "url" }],
  divider: [],
  spacer: [{ key: "height", label: "Height", type: "number" }],
  columns: [{ key: "leftHeading", label: "First heading", variable: true }, { key: "leftText", label: "First text", multiline: true, variable: true }, { key: "rightHeading", label: "Second heading", variable: true }, { key: "rightText", label: "Second text", multiline: true, variable: true }],
  hero: [{ key: "heading", label: "Heading", multiline: true, variable: true }, { key: "text", label: "Text", multiline: true, variable: true }, { key: "buttonLabel", label: "Button label", variable: true }, { key: "buttonUrl", label: "Link URL", type: "url" }],
  logo: [{ key: "name", label: "Brand name", variable: true }, { key: "src", label: "Logo URL", type: "url" }, { key: "alt", label: "Alternative text" }, { key: "url", label: "Link URL", type: "url" }],
  social: [{ key: "website", label: "Website URL", type: "url" }, { key: "linkedin", label: "LinkedIn URL", type: "url" }, { key: "instagram", label: "Instagram URL", type: "url" }],
  menu: [{ key: "firstLabel", label: "First label", variable: true }, { key: "firstUrl", label: "First URL", type: "url" }, { key: "secondLabel", label: "Second label", variable: true }, { key: "secondUrl", label: "Second URL", type: "url" }, { key: "thirdLabel", label: "Third label", variable: true }, { key: "thirdUrl", label: "Third URL", type: "url" }],
  quote: [{ key: "quote", label: "Quote", multiline: true, variable: true }, { key: "author", label: "Author", variable: true }],
  video: [{ key: "thumbnail", label: "Thumbnail URL", type: "url" }, { key: "alt", label: "Alternative text" }, { key: "url", label: "Video URL", type: "url" }, { key: "label", label: "Video label", variable: true }],
  products: [{ key: "firstName", label: "First product", variable: true }, { key: "firstPrice", label: "First price", variable: true }, { key: "firstUrl", label: "First URL", type: "url" }, { key: "secondName", label: "Second product", variable: true }, { key: "secondPrice", label: "Second price", variable: true }, { key: "secondUrl", label: "Second URL", type: "url" }],
  coupon: [{ key: "heading", label: "Heading", variable: true }, { key: "text", label: "Text", multiline: true, variable: true }, { key: "code", label: "Coupon code", variable: true }, { key: "url", label: "Redemption URL", type: "url" }],
  countdown: [{ key: "heading", label: "Heading", variable: true }, { key: "days", label: "Days", type: "number" }, { key: "hours", label: "Hours", type: "number" }, { key: "minutes", label: "Minutes", type: "number" }],
  survey: [{ key: "question", label: "Question", variable: true }, { key: "lowLabel", label: "Low score label" }, { key: "highLabel", label: "High score label" }, { key: "baseUrl", label: "Response URL", type: "url" }],
  feature: [{ key: "eyebrow", label: "Eyebrow" }, { key: "heading", label: "Heading", variable: true }, { key: "text", label: "Text", multiline: true, variable: true }, { key: "linkLabel", label: "Link label", variable: true }, { key: "url", label: "Link URL", type: "url" }],
  stats: [{ key: "firstValue", label: "First value", variable: true }, { key: "firstLabel", label: "First label", variable: true }, { key: "secondValue", label: "Second value", variable: true }, { key: "secondLabel", label: "Second label", variable: true }],
  alert: [{ key: "heading", label: "Heading", variable: true }, { key: "text", label: "Text", multiline: true, variable: true }],
  event: [{ key: "heading", label: "Heading", variable: true }, { key: "date", label: "Event date", variable: true }, { key: "location", label: "Location", variable: true }, { key: "text", label: "Text", multiline: true, variable: true }, { key: "buttonLabel", label: "Button label", variable: true }, { key: "url", label: "Registration URL", type: "url" }],
  pricing: [{ key: "plan", label: "Plan name", variable: true }, { key: "price", label: "Price", variable: true }, { key: "description", label: "Description", multiline: true, variable: true }, { key: "buttonLabel", label: "Button label", variable: true }, { key: "url", label: "Purchase URL", type: "url" }],
  signature: [{ key: "closing", label: "Closing", variable: true }, { key: "image", label: "Portrait URL", type: "url" }, { key: "name", label: "Name", variable: true }, { key: "title", label: "Job title", variable: true }, { key: "company", label: "Company", variable: true }],
  html: [{ key: "html", label: "Custom HTML", multiline: true }],
  footer: [{ key: "company", label: "Company", variable: true }, { key: "address", label: "Address", multiline: true, variable: true }, { key: "unsubscribeLabel", label: "Unsubscribe label" }, { key: "preferencesLabel", label: "Preferences label" }],
};

export function VariablePicker({ onInsert, disabled = false }: { onInsert: (token: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const variables = useMemo(() => EMAIL_VARIABLES.filter((item) => `${item.label} ${item.token}`.toLowerCase().includes(search.toLowerCase())), [search]);
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="outline" size="xs" disabled={disabled} />}><Braces data-icon="inline-start" />Insert variable</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b p-2">
          <div className="relative"><Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 ps-7" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search variables" aria-label="Search variables" /></div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {variables.map((variable) => <button key={variable.token} type="button" className="flex w-full flex-col rounded-md px-2.5 py-2 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onInsert(variable.token)}><span className="text-sm font-medium">{t(variable.label)}</span><code className="text-xs text-muted-foreground">{variable.token}</code></button>)}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BlockInspector({ idPrefix, block, document, onChangeBlock, onChangeDocument }: { idPrefix: string; block: EmailBlock | null; document: EmailDocument; onChangeBlock: (block: EmailBlock) => void; onChangeDocument: (document: EmailDocument) => void }) {
  const { t } = useI18n();
  const [activeField, setActiveField] = useState<string | null>(null);
  const definition = block ? EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === block.type) : null;
  const fields = block ? contentFields[block.type] : [];
  const updateContent = (key: string, value: string) => block && onChangeBlock({ ...block, content: { ...block.content, [key]: value } });
  const updateStyle = (value: Partial<EmailBlock["style"]>) => block && onChangeBlock({ ...block, style: { ...block.style, ...value } });
  const updateSettings = (value: Partial<EmailBlock["settings"]>) => block && onChangeBlock({ ...block, settings: { ...block.settings, ...value } });
  const insertVariable = (token: string) => {
    if (!block || !activeField) return;
    const value = block.content[activeField] ?? "";
    updateContent(activeField, `${value}${value && !/\s$/.test(value) ? " " : ""}${token}`);
  };

  const controlId = (name: string) => `${idPrefix}-${name}-${block?.id ?? "document"}`;

  if (!block) return <DocumentInspector idPrefix={idPrefix} document={document} onChange={onChangeDocument} />;

  return (
    <Tabs defaultValue="content" className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-3 pt-2">
        <div className="flex items-center justify-between gap-2 py-2"><div><p className="text-sm font-semibold">{t(definition?.label ?? block.type)}</p><p className="text-[0.68rem] text-muted-foreground" translate="no">{block.id.split("-")[0]}</p></div><VariablePicker onInsert={insertVariable} disabled={!activeField} /></div>
        <TabsList variant="line" className="w-full"><TabsTrigger value="content" className="flex-1">Content</TabsTrigger><TabsTrigger value="style" className="flex-1">Style</TabsTrigger><TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger></TabsList>
      </div>
      <TabsContent value="content" className="min-h-0 flex-1 overflow-y-auto p-4">
        {fields.length ? <FieldGroup>{fields.map((field) => <Field key={field.key}><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor={controlId(`field-${field.key}`)}>{t(field.label)}</FieldLabel>{field.variable ? <button type="button" className="text-xs text-primary hover:underline" onClick={() => setActiveField(field.key)}>Use variables</button> : null}</div>{field.multiline ? <Textarea id={controlId(`field-${field.key}`)} rows={field.key === "html" ? 12 : 4} className={field.key === "html" ? "font-mono text-xs" : ""} value={block.content[field.key] ?? ""} onFocus={() => field.variable && setActiveField(field.key)} onChange={(event) => updateContent(field.key, event.target.value)} translate="no" data-i18n-ignore={field.key === "html" ? "true" : undefined} /> : <Input id={controlId(`field-${field.key}`)} type={field.type ?? "text"} value={block.content[field.key] ?? ""} onFocus={() => field.variable && setActiveField(field.key)} onChange={(event) => updateContent(field.key, event.target.value)} translate="no" />}</Field>)}</FieldGroup> : <p className="text-sm text-muted-foreground">This element has no content fields. Use Style and Settings to adjust it.</p>}
      </TabsContent>
      <TabsContent value="style" className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          <Field><FieldLabel htmlFor={controlId("font-family")}>Font family</FieldLabel><Select value={block.style.fontFamily} onValueChange={(value) => updateStyle({ fontFamily: String(value) })}><SelectTrigger id={controlId("font-family")} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["Arial, Helvetica, sans-serif", "Georgia, serif", "Tahoma, sans-serif", "Trebuchet MS, sans-serif", "Courier New, monospace"].map((font) => <SelectItem key={font} value={font}>{font.split(",")[0]}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <div className="grid grid-cols-2 gap-3"><Field><FieldLabel htmlFor={controlId("font-size")}>Font size</FieldLabel><Input id={controlId("font-size")} type="number" min={10} max={72} value={block.style.fontSize} onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })} /></Field><Field><FieldLabel htmlFor={controlId("font-weight")}>Font weight</FieldLabel><Select value={block.style.fontWeight} onValueChange={(value) => updateStyle({ fontWeight: String(value) as EmailBlock["style"]["fontWeight"] })}><SelectTrigger id={controlId("font-weight")} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div>
          <Field><FieldLabel>Alignment</FieldLabel><ToggleGroup value={[block.style.align]} onValueChange={(values) => values[0] && updateStyle({ align: values[0] as EmailBlock["style"]["align"] })} variant="outline" spacing={0} aria-label="Text alignment"><ToggleGroupItem value="start" aria-label="Align start"><AlignLeft /></ToggleGroupItem><ToggleGroupItem value="center" aria-label="Align center"><AlignCenter /></ToggleGroupItem><ToggleGroupItem value="end" aria-label="Align end"><AlignRight /></ToggleGroupItem></ToggleGroup></Field>
          <div className="grid grid-cols-2 gap-3"><ColorField id={controlId("text-color")} label="Text color" value={block.style.textColor} onChange={(textColor) => updateStyle({ textColor })} /><ColorField id={controlId("background")} label="Background" value={block.style.backgroundColor === "transparent" ? "#ffffff" : block.style.backgroundColor} onChange={(backgroundColor) => updateStyle({ backgroundColor })} /><ColorField id={controlId("accent-color")} label="Accent color" value={block.style.accentColor} onChange={(accentColor) => updateStyle({ accentColor })} /><ColorField id={controlId("border-color")} label="Border color" value={block.style.borderColor} onChange={(borderColor) => updateStyle({ borderColor })} /></div>
          <div className="grid grid-cols-2 gap-3"><NumberField id={controlId("top-padding")} label="Top padding" value={block.style.paddingTop} onChange={(paddingTop) => updateStyle({ paddingTop })} /><NumberField id={controlId("bottom-padding")} label="Bottom padding" value={block.style.paddingBottom} onChange={(paddingBottom) => updateStyle({ paddingBottom })} /><NumberField id={controlId("inline-padding")} label="Inline padding" value={block.style.paddingInline} onChange={(paddingInline) => updateStyle({ paddingInline })} /><NumberField id={controlId("corner-radius")} label="Corner radius" value={block.style.borderRadius} onChange={(borderRadius) => updateStyle({ borderRadius })} /></div>
        </FieldGroup>
      </TabsContent>
      <TabsContent value="settings" className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          <Field orientation="horizontal"><div><FieldLabel htmlFor={controlId("full-width")}>Full width</FieldLabel><FieldDescription>Remove the outer inline padding for this block.</FieldDescription></div><Switch id={controlId("full-width")} checked={block.settings.fullWidth} onCheckedChange={(value) => updateSettings({ fullWidth: Boolean(value) })} /></Field>
          <FieldSet><FieldLegend variant="label">Responsive visibility</FieldLegend><FieldDescription>Choose the screens where this element should be hidden.</FieldDescription>{(["desktop", "tablet", "mobile"] as EmailDevice[]).map((device) => <Field key={device} orientation="horizontal"><Checkbox id={controlId(`hide-${device}`)} checked={block.settings.hideOn.includes(device)} onCheckedChange={(checked) => updateSettings({ hideOn: checked ? [...block.settings.hideOn, device] : block.settings.hideOn.filter((item) => item !== device) })} /><FieldLabel htmlFor={controlId(`hide-${device}`)} className="capitalize">Hide on {device}</FieldLabel></Field>)}</FieldSet>
        </FieldGroup>
      </TabsContent>
    </Tabs>
  );
}

function DocumentInspector({ idPrefix, document, onChange }: { idPrefix: string; document: EmailDocument; onChange: (document: EmailDocument) => void }) {
  const update = (settings: Partial<EmailDocument["settings"]>) => onChange({ ...document, settings: { ...document.settings, ...settings } });
  return <div className="min-h-0 flex-1 overflow-y-auto"><div className="border-b p-4"><h2 className="text-sm font-semibold">Email settings</h2><p className="mt-1 text-xs text-muted-foreground">Select an element to edit its content and style.</p></div><FieldGroup className="p-4"><Field><FieldLabel htmlFor={`${idPrefix}-email-preheader`}>Preheader</FieldLabel><Textarea id={`${idPrefix}-email-preheader`} rows={3} value={document.settings.preheader} onChange={(event) => update({ preheader: event.target.value })} /><FieldDescription>Hidden inbox preview text shown beside the subject.</FieldDescription></Field><Field><FieldLabel htmlFor={`${idPrefix}-email-width`}>Content width</FieldLabel><Input id={`${idPrefix}-email-width`} type="number" min={480} max={760} value={document.settings.width} onChange={(event) => update({ width: Number(event.target.value) })} /></Field><ColorField id={`${idPrefix}-email-background`} label="Email background" value={document.settings.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} /><ColorField id={`${idPrefix}-content-background`} label="Content background" value={document.settings.contentBackgroundColor} onChange={(contentBackgroundColor) => update({ contentBackgroundColor })} /></FieldGroup></div>;
}

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} type="number" min={0} max={160} value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>;
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><div className="flex gap-2"><Input id={id} type="color" className="size-8 shrink-0 p-1" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(event) => onChange(event.target.value)} /><Input aria-label={`${label} hex value`} value={value} onChange={(event) => onChange(event.target.value)} translate="no" /></div></Field>;
}
