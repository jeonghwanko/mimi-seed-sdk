export default {
  fetch(request, env) {
    if (new URL(request.url).hostname !== "mimi-seed.pryzm.gg") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 410 });
    }

    return new Response(null, {
      status: 301,
      headers: {
        Location: "https://mimi-seed.oddbout.com/",
        "Referrer-Policy": "no-referrer",
      },
    });
  },
};
