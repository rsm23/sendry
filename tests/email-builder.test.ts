import { describe, expect, it } from "vitest";
import {
  EMAIL_BLOCK_DEFINITIONS,
  createDefaultEmailDocument,
  createEmailBlock,
  emailDocumentFromTemplate,
  renderEmailBlock,
  renderEmailDocument,
  renderPlainText,
} from "../src/lib/email-builder";

describe("email template builder", () => {
  it("offers a broad unique element library", () => {
    expect(EMAIL_BLOCK_DEFINITIONS).toHaveLength(20);
    expect(new Set(EMAIL_BLOCK_DEFINITIONS.map((item) => item.type)).size).toBe(20);
    expect(EMAIL_BLOCK_DEFINITIONS.map((item) => item.category)).toContain("Interactive");
    expect(EMAIL_BLOCK_DEFINITIONS.map((item) => item.type)).toEqual(expect.arrayContaining(["hero", "columns", "products", "survey", "html", "footer"]));
  });

  it("renders responsive table HTML and keeps real Sendry variables", () => {
    const document = createDefaultEmailDocument();
    document.blocks.unshift(createEmailBlock("text"));
    document.blocks[0].content.text = "Hello [Name] — [currentmonth]";
    const html = renderEmailDocument(document);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("@media only screen and (max-width:430px)");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("Hello [Name] — [currentmonth]");
    expect(html).toContain("[unsubscribe]");
    expect(renderPlainText(document)).toContain("[preferences]");
  });

  it("uses sample contact values only in live preview", () => {
    const document = createDefaultEmailDocument();
    const text = createEmailBlock("text");
    text.content.text = "Hello [Name] at [Company]";
    document.blocks = [text];
    expect(renderEmailDocument(document, true)).toContain("Hello Sofia at Northwind");
    expect(renderEmailDocument(document)).toContain("Hello [Name] at [Company]");
  });

  it("blocks unsafe authored URLs and honors responsive settings", () => {
    const button = createEmailBlock("button");
    button.content.url = "javascript:alert(1)";
    button.settings.hideOn = ["mobile"];
    button.settings.fullWidth = true;
    const html = renderEmailBlock(button);
    expect(html).toContain('href="#"');
    expect(html).toContain("sendry-hide-mobile");
    expect(html).toContain("padding:18px 0px 18px");
    expect(html).not.toContain("javascript:");
  });

  it("keeps legacy imported HTML editable as a custom HTML element", () => {
    const document = emailDocumentFromTemplate({}, "<h1>Imported newsletter</h1>");
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]).toMatchObject({ type: "html", content: { html: "<h1>Imported newsletter</h1>" } });
  });
});
