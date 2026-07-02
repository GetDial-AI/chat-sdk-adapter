// Format converter. Phone channels (SMS, MMS, iMessage) accept plain text
// plus optional media URLs — no rich markdown, no inline formatting. This
// class flattens Chat SDK's AST to plain text; the only non-trivial case
// is tables, which get rendered as an ASCII code block so the recipient
// still sees the data.

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  isTableNode,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  tableToAscii,
  walkAst,
} from "chat";

export class DialFormatConverter extends BaseFormatConverter {
  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  fromAst(ast: Root): string {
    const cloned = structuredClone(ast);
    const flattened = walkAst(cloned, (node: Content) => {
      if (!isTableNode(node)) return node;
      return {
        type: "code" as const,
        value: tableToAscii(node),
        lang: undefined,
      } as Content;
    });
    return stringifyMarkdown(flattened).trim();
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") return message;
    if ("raw" in message) return message.raw;
    if ("markdown" in message) return this.fromMarkdown(message.markdown);
    if ("ast" in message) return this.fromAst(message.ast);
    return super.renderPostable(message);
  }
}
