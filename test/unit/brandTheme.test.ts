import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The AISC brand theme: the web app's :root carries the
// brand values, body text is Raleway, headings MuseoModerno in --heading, and
// ids, labels and code IBM Plex Mono. Inter is gone. The canonical values live
// in the platform's shared/theme/brand.json; they are copied here so the test
// also runs in a clone of this repo alone, and checked against that file when
// it is there.
const BRAND: Record<string, string> = {
  "--bg": "#f2f3fd",
  "--panel": "#ffffff",
  "--panel-2": "#f2f3fd",
  "--text": "#0b0b2e",
  "--muted": "#4a4f6a",
  "--faint": "#6b7090",
  "--primary": "#000fdf",
  "--primary-hover": "#000079",
  "--accent": "#ff007e",
  "--accent-hover": "#cc0066",
  "--info": "#0099ff",
  "--info-soft": "#ccebff",
  "--pink-soft": "#ffcce5",
  "--border": "#cccff9",
  "--border-strong": "#999ff2",
  "--error": "#e30613",
  "--heading": "#000079",
};

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../../src/app/globals.css");
const layout = read("../../src/app/layout.tsx");
const fonts = existsSync(fileURLToPath(new URL("../../src/app/fonts/fonts.css", import.meta.url)))
  ? read("../../src/app/fonts/fonts.css")
  : "";

const rootBlock = css.match(/:root\s*\{([^}]*)\}/)![1];
const rootVars = Object.fromEntries(
  [...rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);
/** The declarations of the rule whose selector list is exactly `selector`. */
const rule = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/,\s*/g, ",\\s*");
  const m = css.match(new RegExp(`(^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "m"));
  return m ? m[2] : "";
};
/** Every rule (selector, body) outside :root. */
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), body: m[2] }))
  .filter((r) => r.sel !== ":root");

describe("the brand theme", () => {
  it("matches shared/theme/brand.json when the platform checkout has it", () => {
    const url = new URL("../../../../shared/theme/brand.json", import.meta.url);
    if (!existsSync(fileURLToPath(url))) return;
    const brand = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
    expect(BRAND).toEqual(brand.variables);
  });

  it("sets every :root colour variable the app uses to the brand value, in lower-case hex", () => {
    const colourVars = Object.entries(rootVars).filter(([, v]) => v.startsWith("#"));
    expect(colourVars.length).toBeGreaterThan(0);
    for (const [name, value] of colourVars) {
      expect(BRAND[name], `${name} is not a brand variable`).toBeDefined();
      expect(value, name).toBe(BRAND[name]);
    }
    // every brand variable the stylesheet reads is set in :root, and --heading is among them
    for (const m of css.matchAll(/var\((--[\w-]+)\)/g))
      if (m[1] in BRAND) expect(rootVars[m[1]], m[1]).toBe(BRAND[m[1]]);
    expect(rootVars["--heading"]).toBe(BRAND["--heading"]);
  });

  it("sets body text in Raleway and drops Inter", () => {
    expect(rootBlock).toMatch(/font-family:\s*"Raleway"/);
    expect(css).not.toMatch(/Inter\b/);
    expect(layout).not.toMatch(/family=Inter\b/);
  });

  it("sets h1-h4 in MuseoModerno, coloured var(--heading), and no heading rule overrides that colour", () => {
    const h = rule("h1, h2, h3, h4");
    expect(h).toMatch(/font-family:\s*"MuseoModerno"/);
    expect(h).toMatch(/color:\s*var\(--heading\)/);
    for (const r of rules.filter((r) => /(^|[\s,>])h[1-4]\b/.test(r.sel))) {
      const colour = r.body.match(/(^|[;\s])color:\s*([^;]+);/);
      if (colour) expect(colour[2].trim(), r.sel).toBe("var(--heading)");
    }
  });

  it("sets code and the version ids in IBM Plex Mono", () => {
    expect(rule("code, kbd, pre, samp")).toMatch(/font-family:\s*var\(--mono\)/);
    expect(rootVars["--mono"]).toMatch(/^"IBM Plex Mono"/);
    expect(rule(".version-chip")).toMatch(/font-family:\s*var\(--mono\)/);
  });

  it("ships the three families with the app in the brand weights, and asks Google Fonts for none", () => {
    expect(layout).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(layout).toMatch(/import "\.\/fonts\/fonts\.css";/);
    const faces = [...fonts.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    const weightsOf = (family: string) => {
      const covered = new Set<number>();
      for (const face of faces.filter((f) => f.includes(`font-family: "${family}";`))) {
        const [low, high = low] = face.match(/font-weight:\s*(\d+)(?:\s+(\d+))?;/)!.slice(1).filter(Boolean).map(Number);
        for (const w of [400, 500, 600, 700]) if (w >= low && w <= high) covered.add(w);
        expect(face).toMatch(/font-display:\s*swap;/);
        const file = face.match(/url\("\.\/([^"]+\.woff2)"\)/)![1];
        expect(existsSync(fileURLToPath(new URL(`../../src/app/fonts/${file}`, import.meta.url)))).toBe(true);
      }
      return [...covered].sort();
    };
    expect(weightsOf("MuseoModerno")).toEqual(expect.arrayContaining([500, 600, 700]));
    expect(weightsOf("Raleway")).toEqual([400, 500, 600, 700]);
    expect(weightsOf("IBM Plex Mono")).toEqual([400, 500, 600]);
  });

  // shared/theme/brand.json "header": the same header in every app.
  // This header has the logo only, no product title.
  it("sets the site header to 89px: 20px 40px padding, a 1px border, the logo 48px", () => {
    expect(rule(".site-header")).toMatch(/border-bottom:\s*1px solid var\(--border\);/);
    expect(rule(".site-header .inner")).toMatch(/padding:\s*20px 40px;/);
    expect(rule(".site-header .brand img")).toMatch(/height:\s*48px;/);
    expect(rule(".cl-layout")).toMatch(/--site-header-h:\s*89px;/);
  });

  it("sets the header's brand type to 19px MuseoModerno 700, not uppercased or spaced", () => {
    const brand = rule(".site-header .brand");
    expect(brand).toMatch(/font-family:\s*"MuseoModerno"/);
    expect(brand).toMatch(/font-size:\s*19px;/);
    expect(brand).toMatch(/font-weight:\s*700;/);
    expect(brand).not.toMatch(/letter-spacing|text-transform/);
  });

  it("uses the tokens instead of the old literal panel whites and greys", () => {
    for (const r of rules) {
      expect(r.body, r.sel).not.toMatch(/background:\s*#f(ff|fffff)\s*;/i);
      expect(r.body, r.sel).not.toMatch(/#(d8dce5|f5f5f7|6b7280)\b/i);
    }
  });
});
