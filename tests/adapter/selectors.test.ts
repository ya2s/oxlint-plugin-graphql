import { describe, expect, it } from "vitest";
import { compareSpecificity, parseSelector } from "../../src/adapter/selectors.js";
import type { ParsedSelector } from "../../src/adapter/selectors.js";

// compareSpecificity is a pure function, so it can (and must) be verified directly: integration
// coverage through the fixtures only proves the comparator doesn't break anything graphql-eslint
// 4.4.1 currently contains overlapping selectors for (as of this version, only
// naming-convention's two `Name` selectors, whose ESLint-computed order happens to already equal
// insertion order — so a no-op "compare" would pass those fixtures too). These tests build
// synthetic ParsedSelector-shaped objects directly, bypassing esquery.parse entirely, so they
// pin down the actual ordering contract regardless of what graphql-eslint happens to ship.
function selector(overrides: Partial<ParsedSelector>): ParsedSelector {
  return {
    source: "Field",
    isExit: false,
    root: { type: "identifier", value: "field" } as unknown as ParsedSelector["root"],
    attributeCount: 0,
    identifierCount: 0,
    ...overrides,
  };
}

describe("compareSpecificity", () => {
  it("sorts by attributeCount first: fewer attributes is less specific", () => {
    const fewer = selector({ source: "Field", attributeCount: 0, identifierCount: 5 });
    const more = selector({ source: "Field", attributeCount: 1, identifierCount: 0 });

    expect(compareSpecificity(fewer, more)).toBeLessThan(0);
    expect(compareSpecificity(more, fewer)).toBeGreaterThan(0);
  });

  it("falls back to identifierCount when attributeCount ties", () => {
    const fewer = selector({ source: "A", attributeCount: 2, identifierCount: 1 });
    const more = selector({ source: "A", attributeCount: 2, identifierCount: 3 });

    expect(compareSpecificity(fewer, more)).toBeLessThan(0);
    expect(compareSpecificity(more, fewer)).toBeGreaterThan(0);
  });

  it("falls back to source order (alphabetical) when attributeCount and identifierCount both tie", () => {
    const earlier = selector({ source: "AAA", attributeCount: 1, identifierCount: 1 });
    const later = selector({ source: "ZZZ", attributeCount: 1, identifierCount: 1 });

    expect(compareSpecificity(earlier, later)).toBeLessThan(0);
    expect(compareSpecificity(later, earlier)).toBeGreaterThan(0);
  });

  it("returns a negative (never zero) result for two selectors that are equal in every respect", () => {
    // Matches ESLint's own ESQueryParsedSelector#compare doc comment exactly: "a value less
    // than 0 if this selector and otherSelector have the same specificity, and this selector
    // <= otherSelector alphabetically" — the tiebreak uses `<=`, so identical selectors compare
    // as "not greater than", i.e. a stable (never a real tie) sort key.
    const a = selector({ source: "Same", attributeCount: 3, identifierCount: 2 });
    const b = selector({ source: "Same", attributeCount: 3, identifierCount: 2 });

    expect(compareSpecificity(a, b)).toBeLessThan(0);
    expect(compareSpecificity(b, a)).toBeLessThan(0);
  });

  it("orders a realistic mixed list ascending: attributeCount, then identifierCount, then source", () => {
    const list = [
      selector({ source: "z-plain-identifier", attributeCount: 0, identifierCount: 1 }),
      selector({ source: "a-two-attrs", attributeCount: 2, identifierCount: 0 }),
      selector({ source: "b-one-attr-one-id", attributeCount: 1, identifierCount: 1 }),
      selector({ source: "a-one-attr-two-ids", attributeCount: 1, identifierCount: 2 }),
    ];

    const sorted = [...list].sort(compareSpecificity).map((s) => s.source);

    expect(sorted).toEqual([
      "z-plain-identifier", // attributeCount 0 — least specific
      "b-one-attr-one-id", // attributeCount 1, identifierCount 1
      "a-one-attr-two-ids", // attributeCount 1, identifierCount 2
      "a-two-attrs", // attributeCount 2 — most specific
    ]);
  });
});

describe("parseSelector cache", () => {
  it("returns the same parsed object for a repeated source string", () => {
    const first = parseSelector("OperationDefinition[name=undefined]");
    const second = parseSelector("OperationDefinition[name=undefined]");

    expect(second).toBe(first);
  });

  it("returns distinct objects for different source strings", () => {
    const a = parseSelector("Field");
    const b = parseSelector("OperationDefinition");

    expect(a).not.toBe(b);
    expect(a.source).toBe("Field");
    expect(b.source).toBe("OperationDefinition");
  });

  it("strips the :exit suffix from the parsed selector but keeps it on isExit/source", () => {
    const enter = parseSelector("Field");
    const exit = parseSelector("Field:exit");

    expect(enter.isExit).toBe(false);
    expect(exit.isExit).toBe(true);
    expect(exit.source).toBe("Field:exit");
    // Both parse to the same underlying "identifier" selector for "Field" — enter/exit is
    // tracked separately (isExit), not encoded into the esquery selector itself.
    expect(exit.root).toEqual(enter.root);
  });

  it("counts attributeCount/identifierCount correctly for a real selector shape", () => {
    // "OperationDefinition[name=undefined]" is a compound of one identifier + one attribute —
    // exactly the shape no-anonymous-operations (this plugin's baseline example rule) uses.
    const parsed = parseSelector("OperationDefinition[name=undefined]");

    expect(parsed.identifierCount).toBe(1);
    expect(parsed.attributeCount).toBe(1);
  });
});
