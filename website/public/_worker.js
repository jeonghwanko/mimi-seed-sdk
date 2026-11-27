export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== "mimi-seed.pryzm.gg") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 410 });
    }

    const path = url.pathname.replace(/\/$/, "");
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
