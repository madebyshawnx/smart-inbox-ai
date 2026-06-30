import { describe, expect, it } from "vitest";
import { buildRulesFromAnswers } from "@/lib/onboarding";

describe("buildRulesFromAnswers", () => {
  it("produces no rules when every answer is empty or whitespace", () => {
    expect(buildRulesFromAnswers({})).toEqual([]);
    expect(
      buildRulesFromAnswers({
        alwaysPrioritize: "",
        lowPriority: "   ",
        highStakesTopics: "",
        readLater: "  \n ",
        neverIgnore: "",
      }),
    ).toEqual([]);
  });

  it("creates one always-prioritize rule per comma-separated item with weight +100", () => {
    const rules = buildRulesFromAnswers({ alwaysPrioritize: "my boss, jane@acme.com" });

    expect(rules).toEqual([
      { ruleText: "Always prioritize emails from my boss.", priorityWeight: 100 },
      { ruleText: "Always prioritize emails from jane@acme.com.", priorityWeight: 100 },
    ]);
  });

  it("creates one low-priority rule per item with weight -100", () => {
    const rules = buildRulesFromAnswers({ lowPriority: "noreply@, vendor.com" });

    expect(rules).toEqual([
      { ruleText: "Treat emails from noreply@ as low priority.", priorityWeight: -100 },
      { ruleText: "Treat emails from vendor.com as low priority.", priorityWeight: -100 },
    ]);
  });

  it("combines high-stakes topics into a single rule with weight +50", () => {
    const rules = buildRulesFromAnswers({ highStakesTopics: "invoices, contracts, renewals" });

    expect(rules).toEqual([
      {
        ruleText: "Flag anything about invoices, contracts, and renewals as important.",
        priorityWeight: 50,
      },
    ]);
  });

  it("creates one read-later rule per item with weight 0", () => {
    const rules = buildRulesFromAnswers({ readLater: "newsletters, promotions" });

    expect(rules).toEqual([
      { ruleText: "Put newsletters into Read Later.", priorityWeight: 0 },
      { ruleText: "Put promotions into Read Later.", priorityWeight: 0 },
    ]);
  });

  it("combines never-ignore items into a single rule with weight +50", () => {
    const rules = buildRulesFromAnswers({ neverIgnore: "legal notices, my accountant" });

    expect(rules).toEqual([
      {
        ruleText: "Never mark legal notices and my accountant as safe to ignore.",
        priorityWeight: 50,
      },
    ]);
  });

  it("uses a single item verbatim for combined-topic questions (no list joining)", () => {
    const rules = buildRulesFromAnswers({ highStakesTopics: "invoices" });

    expect(rules).toEqual([
      { ruleText: "Flag anything about invoices as important.", priorityWeight: 50 },
    ]);
  });

  it("trims surrounding whitespace and drops blank items between commas", () => {
    const rules = buildRulesFromAnswers({ alwaysPrioritize: "  my boss ,, , jane  " });

    expect(rules).toEqual([
      { ruleText: "Always prioritize emails from my boss.", priorityWeight: 100 },
      { ruleText: "Always prioritize emails from jane.", priorityWeight: 100 },
    ]);
  });

  it("splits on newlines and semicolons as well as commas", () => {
    const rules = buildRulesFromAnswers({ lowPriority: "a@x.com\nb@y.com; c@z.com" });

    expect(rules.map((r) => r.ruleText)).toEqual([
      "Treat emails from a@x.com as low priority.",
      "Treat emails from b@y.com as low priority.",
      "Treat emails from c@z.com as low priority.",
    ]);
  });

  it("aggregates rules across all five questions in order", () => {
    const rules = buildRulesFromAnswers({
      alwaysPrioritize: "boss",
      lowPriority: "spam@x.com",
      highStakesTopics: "invoices",
      readLater: "newsletters",
      neverIgnore: "legal",
    });

    expect(rules).toEqual([
      { ruleText: "Always prioritize emails from boss.", priorityWeight: 100 },
      { ruleText: "Treat emails from spam@x.com as low priority.", priorityWeight: -100 },
      { ruleText: "Flag anything about invoices as important.", priorityWeight: 50 },
      { ruleText: "Put newsletters into Read Later.", priorityWeight: 0 },
      { ruleText: "Never mark legal as safe to ignore.", priorityWeight: 50 },
    ]);
  });

  it("skips a single item whose generated rule text exceeds the max length", () => {
    const longItem = "x".repeat(300);
    const rules = buildRulesFromAnswers({ alwaysPrioritize: `boss, ${longItem}` });

    expect(rules).toEqual([
      { ruleText: "Always prioritize emails from boss.", priorityWeight: 100 },
    ]);
  });
});
