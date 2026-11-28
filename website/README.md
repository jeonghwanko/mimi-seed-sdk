# Mimi Seed project site

The Korean homepage and its [English edition](https://mimi-seed.oddbout.com/en/) are static HTML. Edit the pages and shared assets in `public/`.

The website uses the brown heart-shaped seed and Mimi Seed wordmark from the ODDBOUT portal’s Agent Tools listing. `public/mimi-wordmark.webp` is the original `src/creator/portal/art/mimi-seed-logo.webp` from kaito_web. The favicon and hero use its left-hand symbol in `public/mimi.svg`. Keep both assets in sync with that artwork when updating the site.

The published HTML includes the ODDBOUT directory footer so its links work without JavaScript. Before publishing, regenerate it from the ODDBOUT web checkout with `node sync-footer.mjs /path/to/kaito_web` from this directory. The command refreshes the marked HTML and the matching stylesheet and language switcher in `public/directory/`. Both homepages link to each other through the language switcher. Policy pages keep their own language.

Preview from this directory with `python -m http.server 8080 --directory public`. To publish, use an authenticated Cloudflare Wrangler CLI from this directory:

```sh
wrangler pages deploy public --project-name mimi-seed-project-site --branch main
```

Cloudflare Pages serves [mimi-seed.oddbout.com](https://mimi-seed.oddbout.com/) from the production branch. The custom domain uses a CNAME to `mimi-seed-project-site.pages.dev`.

The retired console hostname `mimi-seed.pryzm.gg` points to the same Pages project. Its Worker permanently redirects GET and HEAD requests for the privacy policy, SDK usage notice, and terms to the corresponding documents. For other paths it redirects to the Korean homepage. It discards query parameters on all redirects and returns HTTP 410 for other methods.
