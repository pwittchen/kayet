# kayet website

Static landing page, served and bundled with [Bun](https://bun.sh).

```sh
bun run dev       # dev server with hot reload (http://localhost:3000)
bun run build     # production build into dist/
bun run preview   # build, then serve dist/ (PORT env var, default 3000)
```

`llms.txt` (an [llmstxt.org](https://llmstxt.org) index) and `llms-full.txt` (features, shortcuts
and config in plain text) are copied into `dist/` as is. Keep them in sync with `index.html`.
