// Serves the production build from dist/ (run `bun run build` first).
const root = new URL("./dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith("/")) path += "index.html";
    if (path.includes("..")) return new Response("Bad request", { status: 400 });
    const file = Bun.file(root + path.slice(1));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});

console.log(`kayet website: http://localhost:${port}`);
