import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { convertNote, renderSlides, splitFrontmatter, convertInline, convertCallouts, outgoingLinks } from "../src/convert/convert";
import { slugify, slugPath, naturalCompare, similarity } from "../src/convert/slug";

const sample = readFileSync(join(__dirname, "fixtures/sample.md"), "utf8");

describe("frontmatter", () => {
  it("strips YAML and collects tags", () => {
    const [meta, body] = splitFrontmatter(sample);
    expect(meta.tags).toEqual(["hld", "system-design"]);
    expect(body.startsWith("\n# ⚡️ Caching")).toBe(true);
  });
  it("leaves notes without frontmatter alone", () => {
    expect(splitFrontmatter("# Hi\n")).toEqual([{}, "# Hi\n"]);
  });
});

describe("inline", () => {
  it("converts image embeds to absolute, percent-encoded URLs", () => {
    const rel: string[] = [];
    expect(convertInline("![[Machine Learning/_resources/x y.png|\"Spaced\"]]", rel, "/")).toBe("![Spaced](/Machine%20Learning/_resources/x%20y.png)");
    expect(convertInline("![[HLD/_resources/ea791949e17991b65863686fdfd76386_MD5.png]]", rel, "/")).toBe("![figure](/HLD/_resources/ea791949e17991b65863686fdfd76386_MD5.png)");
  });
  it("converts wikilinks to bold and records them", () => {
    const rel: string[] = [];
    expect(convertInline("see [[HLD/Load Balancer|the balancer]] and [[CAP Theorem#Consistency]]", rel, "/")).toBe("see **the balancer** and **Consistency**");
    expect(rel).toEqual(["HLD/Load Balancer", "CAP Theorem"]);
  });
  it("handles highlights and comments", () => {
    expect(convertInline("a ==b== %%c%% d", [], "/")).toBe("a <mark>b</mark>  d");
  });
  it("turns note embeds into pointers", () => {
    const rel: string[] = [];
    expect(convertInline("![[Other Note]]", rel, "/")).toBe("*See note: **Other Note***");
    expect(rel).toEqual(["Other Note"]);
  });
});

describe("callouts", () => {
  it("labels the callout and strips the template emoji pair", () => {
    expect(convertCallouts(["> [!note] Watch these", "> 🔵 ✏ Monitor hit/miss ratio."])).toEqual(["> **🔵 Note: Watch these**", "> Monitor hit/miss ratio."]);
  });
  it("capitalizes unknown kinds", () => {
    expect(convertCallouts(["> [!custom]"])).toEqual(["> **Custom**"]);
  });
});

describe("slides", () => {
  const md = renderSlides(convertNote(sample, { relPath: "HLD/Caching.md" }).slides);
  const slides = md.split("\n\n---\n\n");

  it("makes a title slide with tags and path", () => {
    expect(slides[0]).toContain("# ⚡️ Caching Fundamentals");
    expect(slides[0]).toContain("`#hld` · `#system-design`");
    expect(slides[0]).toContain("*HLD/Caching.md*");
    expect(slides[0]).toContain("> **📋 Summary**");
  });
  it("gives each H2 its own slide", () => {
    expect(slides.filter((s) => s.startsWith("## ")).map((s) => s.split("\n")[0])).toEqual([
      "## Overview",
      "## Request Flow 🔁",
      "## Eviction Policies",
      "## Long section · Part A",
      "## Long section · Part B",
      "## Links",
      "## Related notes",
    ]);
  });
  it("uses the split layout for a lone image and inline for several", () => {
    expect(slides[1]).toContain('_MD5.png "right")');
    expect(slides[2]).not.toContain('"right"');
  });
  it("never splits inside a code fence", () => {
    expect(md).toContain("-- a --- inside code must not split\nSELECT 1;");
  });
  it("does not add a Related slide when the note has a Links/Related section... only when missing", () => {
    // sample has "## Links" (no 'related' in heading) so a Related notes slide is appended
    expect(slides[slides.length - 1]).toContain("## Related notes");
    expect(slides[slides.length - 1]).toContain("- Caching Strategies");
    expect(slides[slides.length - 1]).toContain("- Load Balancer");
  });
  it("honours maxSlideLines: a 12-line section paginates at 10 but not at 15", () => {
    const body = Array.from({ length: 12 }, (_, i) => `- item ${i + 1}`).join("\n\n");
    const note = `# T\n\n## Long\n\n${body}\n`;
    const at10 = renderSlides(convertNote(note, { relPath: "T.md" }).slides).split("\n\n---\n\n");
    const at15 = renderSlides(convertNote(note, { relPath: "T.md", maxSlideLines: 15 }).slides).split("\n\n---\n\n");
    expect(at10.map((s) => s.split("\n")[0])).toEqual(["# T", "## Long", "## Long (cont. 2)"]);
    expect(at15.map((s) => s.split("\n")[0])).toEqual(["# T", "## Long"]);
  });
  it("omits the Related notes slide when relatedSlide is false", () => {
    const note = "# T\n\n## A\nsee [[Other]] and [[Third]]\n";
    const on = renderSlides(convertNote(note, { relPath: "T.md" }).slides);
    const off = renderSlides(convertNote(note, { relPath: "T.md", relatedSlide: false }).slides);
    expect(on).toContain("## Related notes");
    expect(off).not.toContain("## Related notes");
  });
  it("keeps --- as a break and honours reveal", () => {
    const out = renderSlides(convertNote("# T\n\n## A\n- x\n- y\n\n---\n\nloose text\n", { relPath: "T.md", reveal: true }).slides);
    expect(out).toContain("- x {reveal}\n- y {reveal}");
    expect(out.split("\n\n---\n\n")).toHaveLength(3);
  });
});

describe("links", () => {
  it("lists outgoing wikilinks in order without embeds", () => {
    expect(outgoingLinks(sample)).toEqual(["Caching Strategies", "HLD/Load Balancer", "CAP Theorem"]);
  });
});

describe("slugs", () => {
  it("slugifies paths", () => {
    expect(slugPath("Java/2. Concurrency & Multithreading/5. Executor Service")).toBe("java/2-concurrency-and-multithreading/5-executor-service");
    expect(slugify("⚡️ Caching Fundamentals")).toBe("caching-fundamentals");
  });
  it("sorts naturally", () => {
    expect(["10. Z", "2. B", "1. A"].sort(naturalCompare)).toEqual(["1. A", "2. B", "10. Z"]);
  });
  it("scores typos as similar", () => {
    expect(similarity("consistant-hashing", "consistent-hashing")).toBeGreaterThan(0.8);
  });
});
