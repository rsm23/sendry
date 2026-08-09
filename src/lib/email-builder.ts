export type EmailDevice = "desktop" | "tablet" | "mobile";

export type EmailBlockType =
  | "layout"
  | "heading"
  | "text"
  | "image"
  | "button"
  | "divider"
  | "spacer"
  | "columns"
  | "hero"
  | "logo"
  | "social"
  | "menu"
  | "quote"
  | "video"
  | "products"
  | "coupon"
  | "countdown"
  | "survey"
  | "html"
  | "footer";

export type EmailBlockCategory =
  | "Layout"
  | "Content"
  | "Media"
  | "Social"
  | "Commerce"
  | "Interactive"
  | "Other";

export type EmailBlockStyle = {
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "400" | "500" | "600" | "700";
  align: "start" | "center" | "end";
  paddingTop: number;
  paddingBottom: number;
  paddingInline: number;
  borderRadius: number;
  borderColor: string;
};

export type EmailBlock = {
  id: string;
  type: EmailBlockType;
  content: Record<string, string>;
  style: EmailBlockStyle;
  settings: {
    hideOn: EmailDevice[];
    fullWidth: boolean;
  };
};

export type EmailDocument = {
  version: 1;
  settings: {
    backgroundColor: string;
    contentBackgroundColor: string;
    width: number;
    fontFamily: string;
    preheader: string;
  };
  blocks: EmailBlock[];
};

export type EmailVariable = {
  label: string;
  token: string;
  sample: string;
  group: "Contact" | "Date" | "Subscription";
};

export const EMAIL_VARIABLES: EmailVariable[] = [
  { label: "First name", token: "[Name]", sample: "Sofia", group: "Contact" },
  { label: "Email", token: "[Email]", sample: "sofia@example.com", group: "Contact" },
  { label: "Company", token: "[Company]", sample: "Northwind", group: "Contact" },
  { label: "Job title", token: "[Job title]", sample: "Operations lead", group: "Contact" },
  { label: "City", token: "[City]", sample: "Paris", group: "Contact" },
  { label: "Country", token: "[Country]", sample: "France", group: "Contact" },
  { label: "Current day", token: "[currentday]", sample: "Monday", group: "Date" },
  { label: "Current month", token: "[currentmonth]", sample: "August", group: "Date" },
  { label: "Current year", token: "[currentyear]", sample: "2026", group: "Date" },
  { label: "Unsubscribe URL", token: "[unsubscribe]", sample: "https://example.test/unsubscribe", group: "Subscription" },
  { label: "Preferences URL", token: "[preferences]", sample: "https://example.test/preferences", group: "Subscription" },
];

export const EMAIL_BLOCK_DEFINITIONS: Array<{
  type: EmailBlockType;
  label: string;
  category: EmailBlockCategory;
  description: string;
}> = [
  { type: "layout", label: "Layout", category: "Layout", description: "A contained section with a heading and body." },
  { type: "columns", label: "Columns", category: "Layout", description: "Two responsive content columns." },
  { type: "spacer", label: "Spacer", category: "Layout", description: "Adjustable vertical breathing room." },
  { type: "divider", label: "Divider", category: "Layout", description: "A horizontal separator." },
  { type: "heading", label: "Heading", category: "Content", description: "A strong section title." },
  { type: "text", label: "Text", category: "Content", description: "Body copy with variables and links." },
  { type: "button", label: "Button", category: "Content", description: "A reliable email call to action." },
  { type: "quote", label: "Quote", category: "Content", description: "A testimonial or highlighted quotation." },
  { type: "image", label: "Image", category: "Media", description: "A responsive image with alt text." },
  { type: "hero", label: "Hero", category: "Media", description: "Headline, supporting copy and primary action." },
  { type: "logo", label: "Logo", category: "Media", description: "A brand wordmark or image logo." },
  { type: "video", label: "Video", category: "Media", description: "A linked video thumbnail." },
  { type: "social", label: "Social", category: "Social", description: "Linked social channels." },
  { type: "menu", label: "Menu", category: "Social", description: "A compact navigation row." },
  { type: "products", label: "Products", category: "Commerce", description: "A two-product recommendation row." },
  { type: "coupon", label: "Coupon", category: "Commerce", description: "A promotional offer and code." },
  { type: "countdown", label: "Countdown", category: "Interactive", description: "A deadline-oriented countdown display." },
  { type: "survey", label: "Survey", category: "Interactive", description: "A one-click feedback question." },
  { type: "html", label: "HTML", category: "Other", description: "Custom trusted email HTML." },
  { type: "footer", label: "Footer", category: "Other", description: "Company details and subscription links." },
];

const baseStyle = (overrides: Partial<EmailBlockStyle> = {}): EmailBlockStyle => ({
  backgroundColor: "transparent",
  textColor: "#17191f",
  accentColor: "#1458e6",
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 16,
  fontWeight: "400",
  align: "start",
  paddingTop: 18,
  paddingBottom: 18,
  paddingInline: 32,
  borderRadius: 0,
  borderColor: "#e5e7eb",
  ...overrides,
});

export function emailBlockId() {
  return `block_${crypto.randomUUID()}`;
}

export function createEmailBlock(type: EmailBlockType): EmailBlock {
  const shared = { id: emailBlockId(), type, settings: { hideOn: [] as EmailDevice[], fullWidth: false } };
  switch (type) {
    case "layout":
      return { ...shared, content: { heading: "A useful update", text: "Share the context your audience needs, then make the next step clear." }, style: baseStyle({ backgroundColor: "#f5f7fb", borderRadius: 8 }) };
    case "heading":
      return { ...shared, content: { text: "Your section heading" }, style: baseStyle({ fontSize: 30, fontWeight: "700", paddingBottom: 8 }) };
    case "text":
      return { ...shared, content: { text: "Hello [Name], write a concise message that gives readers a reason to continue." }, style: baseStyle({ textColor: "#475467", paddingTop: 8 }) };
    case "image":
      return { ...shared, content: { src: "", alt: "Describe this image", link: "" }, style: baseStyle({ paddingInline: 24, borderRadius: 8 }) };
    case "button":
      return { ...shared, content: { label: "Explore the update", url: "https://example.test/update" }, style: baseStyle({ align: "center", fontWeight: "600", borderRadius: 6 }) };
    case "divider":
      return { ...shared, content: {}, style: baseStyle({ paddingTop: 16, paddingBottom: 16, paddingInline: 32 }) };
    case "spacer":
      return { ...shared, content: { height: "32" }, style: baseStyle({ paddingTop: 0, paddingBottom: 0 }) };
    case "columns":
      return { ...shared, content: { leftHeading: "Faster workflows", leftText: "Automations and shortcuts that reduce busywork.", rightHeading: "Smarter insights", rightText: "Reports that help your team make confident decisions." }, style: baseStyle({ backgroundColor: "#f7f9fc", borderRadius: 8, paddingInline: 24 }) };
    case "hero":
      return { ...shared, content: { heading: "Atlas just got better", text: "New capabilities to help your team ship faster and work smarter.", buttonLabel: "See what’s new", buttonUrl: "https://example.test/updates" }, style: baseStyle({ align: "center", backgroundColor: "#edf4ff", paddingTop: 48, paddingBottom: 48, borderRadius: 8 }) };
    case "logo":
      return { ...shared, content: { name: "ATLAS", src: "", alt: "Atlas", url: "https://example.test" }, style: baseStyle({ align: "center", fontSize: 24, fontWeight: "700", paddingTop: 28, paddingBottom: 28 }) };
    case "social":
      return { ...shared, content: { website: "https://example.test", linkedin: "https://linkedin.com", instagram: "https://instagram.com" }, style: baseStyle({ align: "center", textColor: "#475467", paddingTop: 16, paddingBottom: 16 }) };
    case "menu":
      return { ...shared, content: { firstLabel: "Product", firstUrl: "https://example.test/product", secondLabel: "Resources", secondUrl: "https://example.test/resources", thirdLabel: "Contact", thirdUrl: "https://example.test/contact" }, style: baseStyle({ align: "center", fontSize: 14 }) };
    case "quote":
      return { ...shared, content: { quote: "Atlas has become an essential part of our workflow. It helps us save time and deliver more value.", author: "Jamie Lee, Head of Operations" }, style: baseStyle({ backgroundColor: "#f5f7fb", fontSize: 18, borderRadius: 8 }) };
    case "video":
      return { ...shared, content: { thumbnail: "", alt: "Video preview", url: "https://example.test/watch", label: "Watch the two-minute overview" }, style: baseStyle({ align: "center", backgroundColor: "#111827", textColor: "#ffffff", paddingTop: 40, paddingBottom: 40, borderRadius: 8 }) };
    case "products":
      return { ...shared, content: { firstName: "Team plan", firstPrice: "$29 / month", firstUrl: "https://example.test/team", secondName: "Business plan", secondPrice: "$79 / month", secondUrl: "https://example.test/business" }, style: baseStyle({ backgroundColor: "#f7f9fc", borderRadius: 8 }) };
    case "coupon":
      return { ...shared, content: { heading: "A thank-you for being here", text: "Use this code before Friday for 20% off your next order.", code: "THANKYOU20", url: "https://example.test/redeem" }, style: baseStyle({ align: "center", backgroundColor: "#fff8e6", accentColor: "#9a6700", borderRadius: 8 }) };
    case "countdown":
      return { ...shared, content: { heading: "Offer ends soon", days: "02", hours: "14", minutes: "36" }, style: baseStyle({ align: "center", backgroundColor: "#111827", textColor: "#ffffff", borderRadius: 8 }) };
    case "survey":
      return { ...shared, content: { question: "How useful was this update?", lowLabel: "Not useful", highLabel: "Very useful", baseUrl: "https://example.test/feedback" }, style: baseStyle({ align: "center", backgroundColor: "#f5f7fb", borderRadius: 8 }) };
    case "html":
      return { ...shared, content: { html: "<p style=\"margin:0\">Add trusted custom email HTML here.</p>" }, style: baseStyle() };
    case "footer":
      return { ...shared, content: { company: "Atlas Labs, Inc.", address: "123 Market Street, Paris", unsubscribeLabel: "Unsubscribe", preferencesLabel: "Manage preferences" }, style: baseStyle({ align: "center", textColor: "#667085", fontSize: 12, paddingTop: 28, paddingBottom: 28 }) };
  }
}

export function createDefaultEmailDocument(): EmailDocument {
  return {
    version: 1,
    settings: {
      backgroundColor: "#f5f3ee",
      contentBackgroundColor: "#ffffff",
      width: 640,
      fontFamily: "Arial, Helvetica, sans-serif",
      preheader: "The latest product improvements from Atlas.",
    },
    blocks: [
      createEmailBlock("logo"),
      createEmailBlock("hero"),
      createEmailBlock("columns"),
      createEmailBlock("quote"),
      createEmailBlock("social"),
      createEmailBlock("footer"),
    ],
  };
}

export function emailDocumentFromTemplate(editorData: unknown, html: string): EmailDocument {
  if (editorData && typeof editorData === "object") {
    const candidate = editorData as Partial<EmailDocument>;
    if (candidate.version === 1 && Array.isArray(candidate.blocks) && candidate.settings) {
      return candidate as EmailDocument;
    }
  }
  if (html.trim()) {
    const document = createDefaultEmailDocument();
    document.blocks = [createEmailBlock("html")];
    document.blocks[0].content.html = html;
    return document;
  }
  return createDefaultEmailDocument();
}

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
const safeUrl = (value: string) => /^(?:https?:|mailto:|tel:|\[unsubscribe\]|\[preferences\])/i.test(value.trim()) ? value.trim() : "#";
const align = (value: EmailBlockStyle["align"]) => value === "start" ? "left" : value === "end" ? "right" : "center";
const text = (value: string) => escapeHtml(value).replace(/\n/g, "<br>");

function previewVariables(value: string) {
  return EMAIL_VARIABLES.reduce((result, variable) => result.replaceAll(variable.token, variable.sample), value);
}

function link(label: string, url: string, color: string) {
  return `<a href="${escapeHtml(safeUrl(url))}" style="color:${color};text-decoration:none">${escapeHtml(label)}</a>`;
}

export function renderEmailBlock(block: EmailBlock, withPreviewVariables = false) {
  const c = Object.fromEntries(Object.entries(block.content).map(([key, value]) => [key, withPreviewVariables ? previewVariables(value) : value])) as Record<string, string>;
  const s = block.style;
  const a = align(s.align);
  const radius = `${s.borderRadius}px`;
  let inner = "";
  switch (block.type) {
    case "layout":
      inner = `<div style="background:${s.backgroundColor};border:1px solid ${s.borderColor};border-radius:${radius};padding:24px"><h2 style="margin:0 0 10px;font-size:24px;line-height:1.25">${text(c.heading)}</h2><p style="margin:0;color:${s.textColor};line-height:1.6">${text(c.text)}</p></div>`;
      break;
    case "heading":
      inner = `<h2 style="margin:0;font-size:${s.fontSize}px;line-height:1.2;font-weight:${s.fontWeight};color:${s.textColor};text-align:${a}">${text(c.text)}</h2>`;
      break;
    case "text":
      inner = `<p style="margin:0;font-size:${s.fontSize}px;line-height:1.65;font-weight:${s.fontWeight};color:${s.textColor};text-align:${a}">${text(c.text)}</p>`;
      break;
    case "image": {
      const image = c.src ? `<img src="${escapeHtml(safeUrl(c.src))}" alt="${escapeHtml(c.alt)}" width="576" style="display:block;width:100%;max-width:576px;height:auto;border:0;border-radius:${radius}">` : `<div style="box-sizing:border-box;padding:48px 20px;border:1px dashed ${s.borderColor};border-radius:${radius};color:#667085;text-align:center">${escapeHtml(c.alt || "Image")}</div>`;
      inner = c.link ? `<a href="${escapeHtml(safeUrl(c.link))}" style="text-decoration:none">${image}</a>` : image;
      break;
    }
    case "button":
      inner = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${a}"><tr><td bgcolor="${s.accentColor}" style="border-radius:${radius}"><a href="${escapeHtml(safeUrl(c.url))}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:${s.fontSize}px;font-weight:600;text-decoration:none">${escapeHtml(c.label)}</a></td></tr></table>`;
      break;
    case "divider":
      inner = `<div style="height:1px;background:${s.borderColor};line-height:1px;font-size:1px">&nbsp;</div>`;
      break;
    case "spacer":
      inner = `<div style="height:${Math.max(4, Math.min(160, Number(c.height) || 32))}px;line-height:1px;font-size:1px">&nbsp;</div>`;
      break;
    case "columns":
      inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${s.backgroundColor};border-radius:${radius}"><tr><td class="sendry-column" width="50%" valign="top" style="padding:22px 16px"><h3 style="margin:0 0 8px;font-size:18px;color:${s.textColor}">${text(c.leftHeading)}</h3><p style="margin:0;color:#667085;line-height:1.55">${text(c.leftText)}</p></td><td class="sendry-column" width="50%" valign="top" style="padding:22px 16px"><h3 style="margin:0 0 8px;font-size:18px;color:${s.textColor}">${text(c.rightHeading)}</h3><p style="margin:0;color:#667085;line-height:1.55">${text(c.rightText)}</p></td></tr></table>`;
      break;
    case "hero":
      inner = `<div style="background:${s.backgroundColor};border-radius:${radius};padding:42px 28px;text-align:${a}"><h1 style="margin:0 0 14px;font-size:38px;line-height:1.12;color:${s.textColor}">${text(c.heading)}</h1><p style="margin:0 auto 24px;max-width:460px;color:#475467;font-size:17px;line-height:1.6">${text(c.text)}</p><a href="${escapeHtml(safeUrl(c.buttonUrl))}" style="display:inline-block;background:${s.accentColor};color:#ffffff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:6px">${escapeHtml(c.buttonLabel)}</a></div>`;
      break;
    case "logo":
      inner = c.src ? `<a href="${escapeHtml(safeUrl(c.url))}"><img src="${escapeHtml(safeUrl(c.src))}" alt="${escapeHtml(c.alt)}" width="160" style="display:inline-block;max-width:160px;height:auto;border:0"></a>` : `<a href="${escapeHtml(safeUrl(c.url))}" style="color:${s.textColor};font-size:${s.fontSize}px;font-weight:${s.fontWeight};letter-spacing:.18em;text-decoration:none">${escapeHtml(c.name)}</a>`;
      break;
    case "social":
      inner = [link("Website", c.website, s.textColor), link("LinkedIn", c.linkedin, s.textColor), link("Instagram", c.instagram, s.textColor)].join("&nbsp;&nbsp;&nbsp;&nbsp;");
      break;
    case "menu":
      inner = [link(c.firstLabel, c.firstUrl, s.accentColor), link(c.secondLabel, c.secondUrl, s.accentColor), link(c.thirdLabel, c.thirdUrl, s.accentColor)].join("&nbsp;&nbsp;&nbsp;&nbsp;");
      break;
    case "quote":
      inner = `<div style="background:${s.backgroundColor};border-radius:${radius};padding:26px"><p style="margin:0 0 14px;font-size:${s.fontSize}px;line-height:1.55;font-style:italic;color:${s.textColor}">“${text(c.quote)}”</p><p style="margin:0;color:#667085;font-size:13px">— ${text(c.author)}</p></div>`;
      break;
    case "video": {
      const thumbnail = c.thumbnail ? `<img src="${escapeHtml(safeUrl(c.thumbnail))}" alt="${escapeHtml(c.alt)}" width="560" style="display:block;width:100%;height:auto;border:0;border-radius:${radius}">` : `<div style="padding:42px 20px;font-size:42px;color:#ffffff">▶</div>`;
      inner = `<a href="${escapeHtml(safeUrl(c.url))}" style="display:block;background:${s.backgroundColor};border-radius:${radius};color:${s.textColor};text-align:center;text-decoration:none">${thumbnail}<strong style="display:block;padding:14px">${escapeHtml(c.label)}</strong></a>`;
      break;
    }
    case "products":
      inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${s.backgroundColor};border-radius:${radius}"><tr><td class="sendry-column" width="50%" valign="top" style="padding:24px"><strong style="display:block;font-size:18px">${text(c.firstName)}</strong><span style="display:block;margin:7px 0 14px;color:#667085">${text(c.firstPrice)}</span>${link("View plan →", c.firstUrl, s.accentColor)}</td><td class="sendry-column" width="50%" valign="top" style="padding:24px"><strong style="display:block;font-size:18px">${text(c.secondName)}</strong><span style="display:block;margin:7px 0 14px;color:#667085">${text(c.secondPrice)}</span>${link("View plan →", c.secondUrl, s.accentColor)}</td></tr></table>`;
      break;
    case "coupon":
      inner = `<div style="background:${s.backgroundColor};border:1px dashed ${s.accentColor};border-radius:${radius};padding:28px;text-align:${a}"><h2 style="margin:0 0 8px;color:${s.textColor}">${text(c.heading)}</h2><p style="margin:0 0 18px;color:#667085;line-height:1.55">${text(c.text)}</p><a href="${escapeHtml(safeUrl(c.url))}" style="display:inline-block;border:1px solid ${s.accentColor};padding:10px 16px;color:${s.accentColor};font-weight:700;letter-spacing:.12em;text-decoration:none">${escapeHtml(c.code)}</a></div>`;
      break;
    case "countdown":
      inner = `<div style="background:${s.backgroundColor};border-radius:${radius};padding:28px;text-align:${a};color:${s.textColor}"><h2 style="margin:0 0 18px">${text(c.heading)}</h2><table role="presentation" align="center" cellpadding="0" cellspacing="8" border="0"><tr>${[[c.days, "DAYS"], [c.hours, "HOURS"], [c.minutes, "MINUTES"]].map(([value, label]) => `<td style="padding:12px;background:#ffffff;color:#111827;border-radius:6px;text-align:center"><strong style="display:block;font-size:24px">${escapeHtml(value)}</strong><span style="font-size:10px">${label}</span></td>`).join("")}</tr></table></div>`;
      break;
    case "survey":
      inner = `<div style="background:${s.backgroundColor};border-radius:${radius};padding:28px;text-align:${a}"><h3 style="margin:0 0 18px">${text(c.question)}</h3><a href="${escapeHtml(safeUrl(`${c.baseUrl}?score=1`))}" style="display:inline-block;margin:4px;padding:10px 14px;border:1px solid ${s.borderColor};color:${s.textColor};text-decoration:none;border-radius:4px">${escapeHtml(c.lowLabel)}</a><a href="${escapeHtml(safeUrl(`${c.baseUrl}?score=5`))}" style="display:inline-block;margin:4px;padding:10px 14px;background:${s.accentColor};color:#ffffff;text-decoration:none;border-radius:4px">${escapeHtml(c.highLabel)}</a></div>`;
      break;
    case "html":
      inner = c.html;
      break;
    case "footer":
      inner = `<p style="margin:0 0 8px;color:${s.textColor};font-size:${s.fontSize}px">${text(c.company)}<br>${text(c.address)}</p><p style="margin:0;font-size:${s.fontSize}px">${link(c.unsubscribeLabel, "[unsubscribe]", s.textColor)} &nbsp;·&nbsp; ${link(c.preferencesLabel, "[preferences]", s.textColor)}</p>`;
      break;
  }
  const hidden = block.settings.hideOn.map((device) => `sendry-hide-${device}`).join(" ");
  const background = s.backgroundColor === "transparent" || ["layout", "columns", "hero", "quote", "video", "products", "coupon", "countdown", "survey"].includes(block.type) ? "transparent" : s.backgroundColor;
  return `<tr class="sendry-block ${hidden}"><td align="${a}" style="background:${background};padding:${s.paddingTop}px ${block.settings.fullWidth ? 0 : s.paddingInline}px ${s.paddingBottom}px;font-family:${s.fontFamily};font-size:${s.fontSize}px;font-weight:${s.fontWeight};color:${s.textColor}">${inner}</td></tr>`;
}

export function renderEmailDocument(document: EmailDocument, preview = false) {
  const preheader = preview ? previewVariables(document.settings.preheader) : document.settings.preheader;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email</title><style>
body{margin:0!important;padding:0!important;background:${document.settings.backgroundColor};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{border-collapse:collapse}img{border:0;outline:none;text-decoration:none}.sendry-shell{width:100%;max-width:${document.settings.width}px}.sendry-hide-desktop{display:none!important}
@media only screen and (max-width:680px){.sendry-shell{width:100%!important}.sendry-column{display:block!important;width:100%!important;box-sizing:border-box}.sendry-block>td{padding-left:20px!important;padding-right:20px!important}.sendry-hide-desktop{display:table-row!important}.sendry-hide-tablet{display:none!important}}
@media only screen and (max-width:430px){.sendry-hide-tablet{display:table-row!important}.sendry-hide-mobile{display:none!important}h1{font-size:30px!important}}
</style></head><body><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${document.settings.backgroundColor}"><tr><td align="center" style="padding:24px 12px"><table class="sendry-shell" role="presentation" width="${document.settings.width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${document.settings.contentBackgroundColor}" style="width:100%;max-width:${document.settings.width}px;background:${document.settings.contentBackgroundColor};font-family:${document.settings.fontFamily}">${document.blocks.map((block) => renderEmailBlock(block, preview)).join("")}</table></td></tr></table></body></html>`;
}

export function renderPlainText(document: EmailDocument) {
  return document.blocks.map((block) => {
    const c = block.content;
    switch (block.type) {
      case "heading": return c.text;
      case "text": return c.text;
      case "layout": return `${c.heading}\n${c.text}`;
      case "button": return `${c.label}: ${c.url}`;
      case "hero": return `${c.heading}\n${c.text}\n${c.buttonLabel}: ${c.buttonUrl}`;
      case "columns": return `${c.leftHeading}\n${c.leftText}\n\n${c.rightHeading}\n${c.rightText}`;
      case "quote": return `“${c.quote}” — ${c.author}`;
      case "video": return `${c.label}: ${c.url}`;
      case "products": return `${c.firstName} — ${c.firstPrice}: ${c.firstUrl}\n${c.secondName} — ${c.secondPrice}: ${c.secondUrl}`;
      case "coupon": return `${c.heading}\n${c.text}\nCode: ${c.code}\n${c.url}`;
      case "countdown": return `${c.heading}: ${c.days} days, ${c.hours} hours, ${c.minutes} minutes`;
      case "survey": return `${c.question}: ${c.baseUrl}`;
      case "footer": return `${c.company}\n${c.address}\n[unsubscribe]\n[preferences]`;
      case "html": return c.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      default: return "";
    }
  }).filter(Boolean).join("\n\n");
}
