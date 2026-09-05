/** "Java/2. Concurrency & Multithreading/5. Executor Service" -> "java/2-concurrency-and-multithreading/5-executor-service" */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugPath(relNoExt: string): string {
  return relNoExt.split("/").map(slugify).join("/");
}

/** "2-graph-traversal" -> "graph-traversal" */
export const stripNumericPrefix = (s: string) => s.replace(/^\d+(-\d+)*-/, "");

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient on character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (!a || !b || a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let hits = 0;
  for (const [g, n] of A) hits += Math.min(n, B.get(g) ?? 0);
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

/** Natural comparison: "2. Foo" < "10. Bar". */
export function naturalCompare(a: string, b: string): number {
  const ta = a.split(/(\d+)/).filter((t) => t !== "");
  const tb = b.split(/(\d+)/).filter((t) => t !== "");
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i], y = tb[i];
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else {
      const d = x.toLowerCase().localeCompare(y.toLowerCase());
      if (d) return d;
    }
  }
  return ta.length - tb.length;
}
