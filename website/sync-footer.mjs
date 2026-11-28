import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Consume the same renderer used to publish the ODDBOUT site's static pages.
const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: node website/sync-footer.mjs <path-to-kaito_web>");
const shared = pathToFileURL(resolve(checkout, "tools/ai-fighter/static-directory.mjs"));
const { staticDirectory, directoryAssets, directoryCss, directoryScript } = await import(shared.href);
const site = fileURLToPath(new URL("./public/", import.meta.url));
const home = { ko: "/", en: "/en/" };

function withMimiPolicies(footer, lang, page) {
  const privacyLink = /<a\b[^>]*\bdata-club-link="privacy"[^>]*>[^<]*<\/a>/g;
  if (footer.match(privacyLink)?.length !== 1) {
    throw new Error("Expected one privacy link in the shared footer");
  }
  const ko = lang === "ko";
  const links = [
    ["/privacy/", ko ? "개인정보처리방침" : "Privacy Policy (Korean)", "privacy/index.html"],
    ["/terms/", ko ? "이용약관" : "Terms of Service (Korean)", "terms/index.html"],
    ["https://github.com/jeonghwanko/mimi-seed-sdk/blob/main/LICENSE", "PolyForm Noncommercial 1.0.0"],
  ];
  return footer.replace(privacyLink, links.map(([href, label, document]) =>
    `<a href="${href}"${page === document ? ' aria-current="page"' : ""}>${label}</a>`
  ).join(""));
}

for (const file of await readdir(site, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const path = join(site, file);
  const page = file.replaceAll("\\", "/");
  const html = await readFile(path, "utf8");
  const lang = html.match(/<html\b[^>]*\blang="(en|ko)"/)?.[1];
  if (!lang) throw new Error(`Missing supported document language in ${page}`);
  const translations = ["index.html", "en/index.html"].includes(page)
    ? home
    : { [lang]: page === "404.html" ? "#" : "/" + page.replace(/index\.html$/, "") };
  const footer = withMimiPolicies(staticDirectory(lang, { root: "https://oddbout.com/", translations }), lang, page);
  let rendered = html;
  for (const [name, content, closingTag] of [
    ["assets", directoryAssets("/"), "</head>"],
    ["footer", footer, "</body>"],
  ]) {
    const start = `<!-- oddbout:${name} -->`, end = `<!-- /oddbout:${name} -->`;
    const from = rendered.indexOf(start), to = rendered.indexOf(end);
    const block = start + "\n" + content + "\n" + end;
    if (from === -1 && to === -1 && rendered.includes(closingTag)) {
      rendered = rendered.replace(closingTag, () => block + "\n" + closingTag);
    } else if (from >= 0 && to > from) {
      rendered = rendered.slice(0, from) + block + rendered.slice(to + end.length);
    } else {
      throw new Error(`Invalid ${name} markers in ${page}`);
    }
  }
  if (rendered !== html) await writeFile(path, rendered);
}

await mkdir(join(site, "directory"), { recursive: true });
await writeFile(join(site, "directory/footer.css"), directoryCss);
await writeFile(join(site, "directory/language.js"), directoryScript);
