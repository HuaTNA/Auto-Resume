# External integration setup

The application contains complete OAuth redirect, callback, encrypted credential
storage, disconnect, and manual sync flows. Provider credentials are intentionally
kept outside the repository.

## Notion

1. Create a public integration in the Notion Developer Portal.
2. Register this local redirect URI exactly:
   `http://localhost:8000/api/integrations/notion/callback`
3. Add the following values to `.env`:

   ```env
   NOTION_CLIENT_ID=...
   NOTION_CLIENT_SECRET=...
   NOTION_REDIRECT_URI=http://localhost:8000/api/integrations/notion/callback
   ```

4. Restart the API and authorize Notion from **Settings → Integrations**.
5. Share the desired Notion pages with the integration before syncing. Only
   explicitly shared pages are imported into Hua Knowledge.

## Google Calendar

1. Create a Web application OAuth client in Google Cloud Console.
2. Enable the Google Calendar API.
3. Register this local redirect URI exactly:
   `http://localhost:8000/api/integrations/google-calendar/callback`
4. Add the following values to `.env`:

   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:8000/api/integrations/google-calendar/callback
   ```

5. Restart the API and authorize Google Calendar from **Settings → Integrations**.
   The application requests read-only calendar access. Manual sync imports upcoming
   events as tasks and skips previously imported event IDs.

## Credential security

OAuth access and refresh tokens are encrypted before database storage. Configure
an independent secret in production:

```env
INTEGRATION_ENCRYPTION_KEY=<at-least-32-random-bytes>
```

The API never returns encrypted credential material to the browser or account
exports. When this value is omitted locally, the protected persistent JWT secret
is used. Changing either secret invalidates existing encrypted connections, which
must then be reauthorized.
