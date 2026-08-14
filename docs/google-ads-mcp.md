# Connecting Google Ads to OpenClaw through Extend Panel

Google publishes an official Google Ads MCP server: <https://github.com/googleads/google-ads-mcp>.
It is **read-only** — three tools (`search`, `get_resource_metadata`,
`list_accessible_customers`). The agent can report on campaigns; it cannot pause
them, change bids, or create assets.

Google does **not** host it. Each student runs their own copy. Unlike Meta, there
is no app review: everything below is self-serve and free.

## Why the panel can drive this

The server, run in HTTP mode, advertises open dynamic client registration, PKCE
S256, and `token_endpoint_auth_method: "none"` — exactly the shape OpenClaw's MCP
OAuth expects. So the panel's normal "add a server, log in" flow works with no
code changes.

Verified against a live deployment on the VPS:

| Step | Result |
| --- | --- |
| `docker build` from the GitHub URL | image built, 551 MB |
| Traefik route + Let's Encrypt | `https://…/mcp` served, valid cert |
| Unauthenticated request | `401` + RFC 9728 `resource_metadata` pointer |
| Dynamic client registration | accepted OpenClaw's `http://localhost:8989/oauth/callback` |
| `openclaw mcp login` | produced a valid PKCE authorize URL with the `adwords` scope |

Not verified: Google's own consent screen and a real query, which need a real
developer token and OAuth client.

## What the student needs first

Both are free, and neither is reviewed by a human.

**1. A Google Ads developer token.** Sign in to a Google Ads **manager (MCC)**
account → Tools → API Center. New tokens start at *Test account* level, which
only reads test accounts. Reading a real ad account needs **Explorer** level —
often granted automatically, otherwise requested from the same page. Explorer
allows 2,880 operations/day, which is far more than a student will use.

**2. A Google Cloud project.** No billing account required.
- Enable the **Google Ads API** in the project.
- Create an OAuth client, type **Web application**.
- Add one authorized redirect URI: `https://<their-server-address>/auth/callback`
  (the path is FastMCP's default and is not configurable here).
- Keep the client ID and client secret; note the project ID.

## If students should not touch Google Cloud

The Google Ads API has no API-key path, so an OAuth client has to exist. The
choice is only about who owns it.

**One server, owned by the instructor.** Do the two steps above once, run a single
server, and give every student the same URL. The student's own Google token is
what selects their ad account — the server's developer token is only the API
pass, so students need neither a Cloud project nor a token of their own. Verified
in `ads_mcp/utils.py`: the FastMCP access token takes precedence over the
server's own credentials.

What that commits the instructor to:

- One Explorer developer token is 2,880 operations/day **shared by everyone**.
  Basic access (free, about five business days) raises it to 15,000/day.
- The OAuth app stays unverified, so students see a "Google hasn't verified this
  app" screen, and there is a **100-user lifetime cap** that cannot be reset.
- Keep the app in *Testing* and refresh tokens expire after 7 days. Publish it to
  *Production* to avoid weekly re-logins.
- The server now holds every student's Google Ads access token. Treat the box
  accordingly.
- Using one developer token against other people's accounts makes the instructor
  an API tool provider under Google's terms.

**A hosted third-party server** (Adspirer, Otto, adkit) owns both the developer
token and the OAuth client, so the student only pastes a URL and signs in. These
are paid, and student ad data passes through a third party.

**No API at all.** Schedule a Google Ads report into Google Sheets or email and
let the agent read that. No OAuth client, no developer token — but the data is
only as fresh as the schedule and ad-hoc questions are not possible.

## Deploy the server

Hosting it on the same VPS as OpenClaw avoids Cloud Run and its billing
requirement. Run these on the **host** shell, not the app terminal — from
Hostinger's browser terminal, type `exit` first.

```sh
docker build -t gads-mcp:latest https://github.com/googleads/google-ads-mcp.git
mkdir -p /docker/gads-mcp/data
```

Then `/docker/gads-mcp/docker-compose.yml`, with the four `PASTE_HERE` values
filled in and the host name matching the student's own VPS:

```yaml
services:
  gads:
    image: gads-mcp:latest
    container_name: gads-mcp
    restart: unless-stopped
    environment:
      GOOGLE_PROJECT_ID: PASTE_HERE
      GOOGLE_ADS_DEVELOPER_TOKEN: PASTE_HERE
      GOOGLE_ADS_MCP_OAUTH_CLIENT_ID: PASTE_HERE.apps.googleusercontent.com
      GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET: PASTE_HERE
      GOOGLE_ADS_MCP_BASE_URL: https://gads-openclaw-wsmk.srv1846913.hstgr.cloud
      GOOGLE_ADS_MCP_STORAGE_TYPE: filetree
      GOOGLE_ADS_MCP_STORAGE_PATH: /data/oauth
      PORT: "8080"
    volumes:
      - /docker/gads-mcp/data:/data
    labels:
      - traefik.enable=true
      - traefik.http.routers.gadsmcp.rule=Host(`gads-openclaw-wsmk.srv1846913.hstgr.cloud`)
      - traefik.http.routers.gadsmcp.entrypoints=websecure
      - traefik.http.routers.gadsmcp.tls.certresolver=letsencrypt
      - traefik.http.services.gadsmcp.loadbalancer.server.port=8080
```

```sh
cd /docker/gads-mcp && docker compose up -d
```

Notes that matter:

- The subdomain is a `gads-` prefix on the OpenClaw app's own host name. Hostinger
  resolves the whole wildcard, so any prefix works and Let's Encrypt issues on
  first request.
- `GOOGLE_ADS_MCP_BASE_URL` must be that exact HTTPS address, and the OAuth
  client's redirect URI must be that address plus `/auth/callback`. A mismatch is
  the one failure that only shows up at the Google consent screen.
- `filetree` storage keeps the login across restarts. Without it, every restart
  forces a re-login.
- If the student reaches their ad account through a manager account, add
  `GOOGLE_ADS_LOGIN_CUSTOMER_ID` with the manager's customer ID.

Confirm before moving on — a `401` is the correct, healthy answer here:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://gads-openclaw-wsmk.srv1846913.hstgr.cloud/mcp
```

## Connect it in the panel

Send `/extend` in chat, open the link, then:

1. **خوادم MCP** → **إضافة خادم MCP**.
2. Paste the server URL, ending in `/mcp`.
3. Turn on **يحتاج تسجيل دخول (OAuth)**. Leave the access-key box alone — it
   disappears, because a static key is ignored once OAuth is on.
4. **إضافة**. The server is named `gads` automatically, from the host name.
5. Open it from the list → **ابدأ تسجيل الدخول**. Preparing takes about fifteen
   seconds: that is discovery plus dynamic client registration.
6. Open the link it shows. The server's own **Application Access Request** page
   appears first, then Google's sign-in and permission screen.
7. The browser then lands on a page that fails to load. That is expected — it is
   `127.0.0.1` on the student's phone. Copy the whole address from the address
   bar and paste it into **الرابط الذي وصلت إليه**, then **إكمال الربط**.

The panel already spells out steps 6 and 7 on screen, so the video can follow it.

Optionally turn off **يطلب الإذن قبل التنفيذ** on the server's page. The server is
read-only, so pre-approving its tools is a reasonable default and removes a
prompt before every question.

## Prove it in chat

Ask something that needs the account list first — it is the cheapest call and
fails loudly if the developer token is still at Test level:

> كم حساب إعلاني أقدر أوصله؟

Then a real reporting question:

> كم حملة نشطة عندي، وكم صرفت هذا الأسبوع؟

## Failure modes worth filming

| Symptom | Cause |
| --- | --- |
| Google says `redirect_uri_mismatch` | OAuth client redirect URI is not `<BASE_URL>/auth/callback` |
| Login succeeds, queries say the token is test-only | Developer token still at Test level; request Explorer in API Center |
| Login is lost after a restart | `GOOGLE_ADS_MCP_STORAGE_TYPE` not set to `filetree` |
| Agent answers from general knowledge instead of the account | Server disabled, or scoped to a different agent |
