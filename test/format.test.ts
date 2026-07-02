import { describe, expect, it } from "vitest";
import { DialFormatConverter } from "../src/format";

const converter = new DialFormatConverter();

describe("DialFormatConverter", () => {
  it("round-trips plain text", () => {
    const ast = converter.toAst("hello, world");
    expect(converter.fromAst(ast)).toContain("hello, world");
  });

  it("flattens a markdown table to an ASCII code block", () => {
    const table = ["| A | B |", "|---|---|", "| 1 | 2 |"].join("\n");
    const ast = converter.toAst(table);
    const rendered = converter.fromAst(ast);
    expect(rendered).toContain("A");
    expect(rendered).toContain("B");
    expect(rendered).not.toMatch(/\|\s*A\s*\|/); // pipe-delimited row removed
  });

  it("passes plain-string postable messages through untouched", () => {
    expect(converter.renderPostable("just text")).toBe("just text");
  });

  it("passes { raw } postable messages through untouched", () => {
    expect(converter.renderPostable({ raw: "raw content" })).toBe("raw content");
  });

  it("converts { markdown } postable messages", () => {
    expect(converter.renderPostable({ markdown: "**bold**" })).toContain("bold");
  });
});
