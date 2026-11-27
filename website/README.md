# Mimi Seed project site

The Korean homepage and its [English edition](https://mimi-seed.oddbout.com/en/) are static HTML. Edit the pages and shared assets in `public/`.

Preview from this directory with `python -m http.server 8080 --directory public`. To publish, use an authenticated Cloudflare Wrangler CLI from this directory:

```sh
wrangler pages deploy public --project-name mimi-seed-project-site --branch main
```

Cloudflare Pages serves [mimi-seed.oddbout.com](https://mimi-seed.oddbout.com/) from the production branch. The custom domain uses a CNAME to `mimi-seed-project-site.pages.dev`.

The retired console hostname `mimi-seed.pryzm.gg` points to the same Pages project. Its Worker sends a permanent redirect to the Korean homepage for GET and HEAD requests, discards the original path and query, and returns HTTP 410 for other methods.
