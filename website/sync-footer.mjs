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
  const footer = staticDirectory(lang, { root: "https://oddbout.com/", translations });
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
