# pirol

Next.js 16 (Turbopack) + React 19 + Supabase app.

## Running the app

Start the dev server with:

```bash
npm run dev
```

Serves at **http://localhost:3000** (loads `.env.local`). Turbopack cold start is fast (~sub-second once deps are installed).

## Other scripts

- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint (`eslint-config-next`)
- `npm test` — run Vitest once
- `npm run test:watch` — Vitest in watch mode
