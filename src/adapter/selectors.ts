import esquery from "esquery";

type EsquerySelector = ReturnType<typeof esquery.parse>;
type MultiSelector = Extract<EsquerySelector, { selectors: EsquerySelector[] }>;
type BinarySelector = Extract<EsquerySelector, { left: EsquerySelector; right: EsquerySelector }>;

export type ParsedSelector = {
  /** The raw key as it appeared on the rule's visitor object, e.g. `"Field:exit"`. */
  source: string;
  isExit: boolean;
  root: EsquerySelector;
  attributeCount: number;
  identifierCount: number;
};

// Mirrors ESLint's own selector cache (lib/linter/esquery.js's module-level `selectorCache`):
// a rule's `create()`/`createOnce()` runs fresh per document, so without caching, every rule
// re-parses (and re-analyzes) the same handful of selector strings once per embedded document.
const selectorCache = new Map<string, ParsedSelector>();

export function parseSelector(source: string): ParsedSelector {
  const cached = selectorCache.get(source);
  if (cached) return cached;

  const isExit = source.endsWith(":exit");
  const cleanSource = isExit ? source.slice(0, -":exit".length) : source;
  const root = esquery.parse(cleanSource);
  const { attributeCount, identifierCount } = analyzeSelector(root);

  const parsed: ParsedSelector = { source, isExit, root, attributeCount, identifierCount };
  selectorCache.set(source, parsed);
  return parsed;
}

/**
 * Mirrors ESLint's `ESQueryParsedSelector#compare` (lib/linter/esquery.js): sort ascending by
 * attribute/pseudo-class/field count, then by identifier count, then alphabetically by the raw
 * source as a stable tiebreak. Applied identically for both the enter and exit phases — despite
 * the intuitive-sounding "enter ascending, exit descending", ESLint's own
 * `source-code-traverser.js` sorts BOTH `enterSelectorsByNodeType`/`anyTypeEnterSelectors` and
 * `exitSelectorsByNodeType`/`anyTypeExitSelectors` with this same ascending comparator.
 */
export function compareSpecificity(a: ParsedSelector, b: ParsedSelector): number {
  return a.attributeCount - b.attributeCount || a.identifierCount - b.identifierCount || (a.source <= b.source ? -1 : 1);
}

/**
 * Counts the attribute/pseudo-class/field queries and identifier queries in a parsed selector,
 * mirroring ESLint's `analyzeSelector` (lib/linter/esquery.js) exactly — same switch, same
 * cases — but dropping the `nodeTypes` narrowing that function also computes: that's an
 * optimization for bucketing selectors by node type before matching, which this plugin's
 * simpler per-node "test every listener" dispatch doesn't need.
 */
function analyzeSelector(selector: EsquerySelector): { attributeCount: number; identifierCount: number } {
  let attributeCount = 0;
  let identifierCount = 0;

  function visit(sel: EsquerySelector): void {
    switch (sel.type) {
      case "identifier":
        identifierCount++;
        return;
      case "not":
      case "matches":
      case "compound":
        for (const child of (sel as MultiSelector).selectors) visit(child);
        return;
      case "attribute":
      case "field":
      case "nth-child":
      case "nth-last-child":
        attributeCount++;
        return;
      case "child":
      case "descendant":
      case "sibling":
      case "adjacent": {
        const binary = sel as BinarySelector;
        visit(binary.left);
        visit(binary.right);
        return;
      }
      default:
        return;
    }
  }

  visit(selector);
  return { attributeCount, identifierCount };
}
