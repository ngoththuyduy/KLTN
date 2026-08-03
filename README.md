<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/7c538a8a-5a0c-416e-bebd-c847b013b554

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env](.env) or [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy note

On hosting/Plesk/Passenger, configure `GEMINI_API_KEY` as a server environment variable, or upload a server-readable `.env` / `.env.local` next to `app.js`.

For Plesk/Passenger, use this startup file:

```text
plesk-start.cjs
```

Do not use a static-only startup such as `static_dist`, because `/api/*` routes need the Express backend.

After deploy, open `/api/health` and check:

- `geminiConfigured: true`
- `geminiKeySource: "env"` or `"firestore"`
- `authVerifierConfigured: true`

If `geminiConfigured` is `false`, AI routes will return `MissingApiKey` until the server can read the key.
If `authVerifierConfigured` is `false`, protected `/api/*` routes cannot verify real Firebase users; configure `FIREBASE_SERVICE_ACCOUNT_JSON` on the host.
