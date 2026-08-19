# Setup

Every credential the pipeline needs, and how to get it. Set them twice: in `.env` for
local runs, and as **repository secrets** for GitHub Actions
(Settings → Secrets and variables → Actions).

Non-secret settings (`RENDERER`, `LLM_MODEL`, `TIKTOK_HANDLE`, `PUBLIC_MEDIA_BASE_URL`)
go under the **Variables** tab, not Secrets.

---

## 1. Claude — required

`ANTHROPIC_API_KEY` from https://console.anthropic.com → API Keys.

Without it nothing gets scripted. It is the one credential with no fallback.

Optional: `LLM_BASE_URL=http://localhost:20128` routes through a local 9router gateway
instead of calling Anthropic directly. Only useful on station D — a GitHub runner
cannot reach your localhost.

---

## 2. Whop — optional

`WHOP_API_KEY` only syncs titles and prices for products you have API access to. The
pipeline runs fine without it on `manualProducts` alone, which is the recommended setup.

---

## 3. YouTube

You need OAuth credentials and a **refresh token**, which is the only credential shape
that works in a headless scheduled job.

1. Google Cloud Console → new project → enable **YouTube Data API v3**.
2. OAuth consent screen → External → add yourself as a test user.
3. Credentials → Create OAuth client ID → **Desktop app**.
   Save `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
4. Mint the refresh token once by hand. Open this in a browser, replacing the id:

   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=http://localhost
     &response_type=code
     &scope=https://www.googleapis.com/auth/youtube.upload%20https://www.googleapis.com/auth/youtube.readonly
     &access_type=offline
     &prompt=consent
   ```

   Approve, then copy the `code` parameter out of the URL you land on and exchange it:

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET \
     -d code=THE_CODE \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost
   ```

   The `refresh_token` in the response is `YOUTUBE_REFRESH_TOKEN`.

`prompt=consent` matters — without it Google returns no refresh token on repeat
authorisations, and you get an access token that dies in an hour.

**Quota:** a video upload costs 1600 units of the default 10,000/day. That is six
uploads per day before you need a quota increase — comfortably above the default
cadence of two.

---

## 4. Instagram

Requires an Instagram **Business or Creator** account linked to a Facebook Page. A
personal account cannot publish through the API at all.

1. https://developers.facebook.com → create an app → type **Business**.
2. Add the **Instagram Graph API** product.
3. Graph API Explorer → request `instagram_basic`, `instagram_content_publish`,
   `pages_read_engagement`, `pages_show_list`.
4. `INSTAGRAM_USER_ID` — your IG business account id:
   `GET /me/accounts` → take the page id → `GET /{page-id}?fields=instagram_business_account`
5. `INSTAGRAM_ACCESS_TOKEN` — exchange the short-lived token for a long-lived one:

   ```bash
   curl -s "https://graph.facebook.com/v21.0/oauth/access_token\
   ?grant_type=fb_exchange_token\
   &client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
   ```

Long-lived page tokens last about 60 days. Put a calendar reminder to refresh it —
expiry shows up as `all platforms failed`, and it is the single most common cause.

**Publishing limit:** 25 API-published posts per 24 hours.

---

## 5. TikTok

1. https://developers.tiktok.com → create an app.
2. Add the **Content Posting API** product and request the `video.publish` scope.
3. Save `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
4. Complete the OAuth flow once to obtain `TIKTOK_REFRESH_TOKEN`. Access tokens live
   24 hours; the refresh token is what you store.
5. Set `TIKTOK_HANDLE` (a Variable, not a secret) so result URLs are correct.

Unaudited apps can only post to accounts registered as testers, and posts land as
private drafts. Submit for audit before expecting public posts.

---

## 6. Rendering — only for `RENDERER=ffmpeg`

- `ELEVENLABS_API_KEY` from https://elevenlabs.io → Profile → API key
- `ELEVENLABS_VOICE_ID` from the Voice Library — pick one and commit to it; the voice
  is the most recognisable thing about the channel
- Add at least one vertical clip to `media/broll/` that you own or have licensed

---

## 7. Media hosting

Instagram fetches videos from a public URL rather than accepting an upload. By default
`lib/hosting.js` uploads the file as a GitHub release asset and uses that URL — no
configuration needed, and it works out of the box in Actions.

Set `PUBLIC_MEDIA_BASE_URL` (Variable) only if you already host media elsewhere.

---

## Verifying

```bash
npm run health
```

It lists every missing credential for every enabled platform. Green here means the
pipeline can actually run; the first real run is the workflow `Pipeline` with
`dry_run` checked.
