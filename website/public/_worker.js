export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== "mimi-seed.pryzm.gg") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 410 });
    }

    // Old links may carry case, repeated slashes, /index.html, .html or an /en prefix — normalize before matching so a
    // store listing or OAuth consent screen that still points at the retired host lands on the policy, not the homepage.
    const path = url.pathname
      .toLowerCase()
      .replace(/\/{2,}/g, "/")
      .replace(/\/index\.html$/, "")
      .replace(/\.html$/, "")
      .replace(/\/+$/, "")
      .replace(/^\/en(?=\/)/, "");
    const destination = ["/privacy", "/privacy/sdk-usage", "/terms"].includes(path) ? path + "/" : "/";
    return new Response(null, {
      status: 301,
      headers: {
        Location: "https://mimi-seed.oddbout.com" + destination,
        "Referrer-Policy": "no-referrer",
      },
    });
  },
};
