# Web Deployment

Streambert can run as a Vercel-hosted web app without exposing a TMDB bearer
token in the client bundle.

Configure one of these environment variables in the Vercel project:

- `TMDB_READ_ACCESS_TOKEN`
- `STREAMBERT_TMDB_TOKEN`

The browser app probes `/api/tmdb` at startup. If the server-side variable is
present and valid, the setup screen is skipped and TMDB requests are proxied
through the Vercel function.

For Electron development, launch with `STREAMBERT_TMDB_TOKEN` in the process
environment. On first run, Streambert imports it into the existing encrypted
secure storage path, then uses the normal desktop TMDB flow.
