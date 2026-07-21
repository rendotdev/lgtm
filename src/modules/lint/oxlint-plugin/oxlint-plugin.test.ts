import type { Context, ESTree, Rule } from "@oxlint/plugins";
import { describe, expect, it, vi } from "vite-plus/test";
import { namedCompoundIfConditionRule } from "./oxlint-plugin.ts";

describe("namedCompoundIfConditionRule", () => {
  it("reports logical expressions used directly by if statements", () => {
    const report = vi.fn();
    const visitor = createVisitor(namedCompoundIfConditionRule, report);

    visitor.IfStatement?.({ test: { type: "LogicalExpression" } } as ESTree.IfStatement);

    expect(report).toHaveBeenCalledWith({
      node: { type: "LogicalExpression" },
      messageId: "nameCondition",
    });
  });

  it("allows named boolean conditions", () => {
    const report = vi.fn();
    const visitor = createVisitor(namedCompoundIfConditionRule, report);

    visitor.IfStatement?.({ test: { type: "Identifier" } } as ESTree.IfStatement);

    expect(report).not.toHaveBeenCalled();
  });
});

function createVisitor(rule: Rule, report: ReturnType<typeof vi.fn>) {
  const create = rule.create;
  if (!create) {
    throw new Error("The Oxlint rule must provide a create visitor.");
  }
  return create({ report } as unknown as Context);
}
