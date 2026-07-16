import { DomainClass } from "../../domain/domain-class.ts";

type MarkdownTreeNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownTreeNode[];
};

export class DocumentMarkdownNavigationClass extends DomainClass<{}, {}> {
  public buildHeadingIdPlugin(params: {}) {
    void params;
    return this.createHeadingIdTransformer.bind(this);
  }

  public linkAttributes(params: { href?: string }) {
    const isDocumentAnchor = params.href?.startsWith("#") ?? false;
    if (isDocumentAnchor) {
      return {};
    }
    return { target: "_blank" as const, rel: "noreferrer" };
  }

  private addHeadingIds(params: { tree: MarkdownTreeNode }): void {
    const slugCounts = new Map<string, number>();
    this.visitNode({ node: params.tree, slugCounts });
  }

  private createHeadingIdTransformer() {
    return this.transformHeadingIds.bind(this);
  }

  private transformHeadingIds(tree: MarkdownTreeNode): void {
    this.addHeadingIds({ tree });
  }

  private visitNode(params: { node: MarkdownTreeNode; slugCounts: Map<string, number> }): void {
    const isHeading = /^h[1-6]$/.test(params.node.tagName ?? "");
    if (isHeading) {
      const text = this.readText({ node: params.node });
      const baseSlug = this.slugify({ text });
      const occurrence = params.slugCounts.get(baseSlug) ?? 0;
      params.slugCounts.set(baseSlug, occurrence + 1);
      const id = occurrence === 0 ? baseSlug : `${baseSlug}-${occurrence}`;
      params.node.properties = { ...params.node.properties, id };
    }
    for (const child of params.node.children ?? []) {
      this.visitNode({ node: child, slugCounts: params.slugCounts });
    }
  }

  private readText(params: { node: MarkdownTreeNode }): string {
    if (params.node.type === "text") {
      return params.node.value ?? "";
    }
    return (params.node.children ?? []).map((child) => this.readText({ node: child })).join("");
  }

  private slugify(params: { text: string }): string {
    return params.text
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-");
  }
}

export const DocumentMarkdownNavigation = new DocumentMarkdownNavigationClass({}, {});
