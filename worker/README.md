# Cloudflare Worker: Sheets Proxy

This worker provides a CORS-friendly proxy for Google Sheets API requests and image fetching.

## Features

- **Sheet Discovery**: Get list of worksheets in a spreadsheet
- **Data Extraction**: Fetch cell values from a specific worksheet
- **Image Proxy**: Fetch images with proper CORS headers

## Setup

### 1. Get a Google API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Google Sheets API**
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Restrict the key to the Google Sheets API. Google documents [API-key restrictions](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys) and recommends restricting both the client and the APIs the key can call. Because this key is used by the Worker, keep it server-side and do not add browser referrer restrictions intended for a browser client.

### 2. Deploy to Cloudflare

The maintained deployment configuration is [`worker/wrangler.jsonc`](wrangler.jsonc). Use that file when deploying this repository; do not create a second `wrangler.toml` beside it with copied values. It pins the current compatibility date, enables Workers observability with query-string redaction, binds `KNOWN_SELF_HOSTS`, and configures the maintained `RATE_LIMITER` namespace at 600 requests per 60 seconds. The checked-in account and namespace values are deployment-specific. For a different Cloudflare account or a custom Worker, change the Worker name, account, `KNOWN_SELF_HOSTS`, and rate-limit namespace explicitly, then verify the deployed endpoint before configuring the plugin. The repository source and configuration are proposed deployment inputs; this guide does not claim that the Worker is deployed.

#### Option A: Cloudflare Dashboard

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **Workers & Pages** → **Create Application** → **Create Worker**
3. Replace the default code with contents of `sheets-proxy.js`
4. Go to **Settings** → **Variables** → **Add Variable**
   - Name: `GOOGLE_API_KEY`
   - Value: Your Google API key
   - Check "Encrypt"
5. Save and deploy

#### Option B: Wrangler CLI

1. Install Wrangler: `npm install -g wrangler`
2. Login: `wrangler login`
3. If you are deploying a custom copy rather than the maintained configuration, create a Wrangler config with equivalent settings:
   ```toml
   name = "sheets-proxy"
   main = "sheets-proxy.js"
   compatibility_date = "2025-12-14"
   workers_dev = true
   preview_urls = false

   [vars]
   KNOWN_SELF_HOSTS = "your-worker-name.your-subdomain.workers.dev"

   # Optional: configure a per-client binding. Choose a unique positive integer
   # namespace_id for your Cloudflare account.
   [[ratelimits]]
   name = "RATE_LIMITER"
   namespace_id = 2026091201
   simple = { limit = 600, period = 60 }
   ```
   The rate-limit binding requires Wrangler 4.36.0 or newer; see Cloudflare's [Rate Limiting binding reference](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Replace the example namespace with a unique positive integer for your account. This binding is optional; without it the Worker source still enforces request and response limits, but a public endpoint has no per-client request cap.
4. Add secret: `wrangler secret put GOOGLE_API_KEY`. Cloudflare's [Workers secrets guide](https://developers.cloudflare.com/workers/configuration/secrets/) explains that secrets are encrypted bindings and are not visible after they are set.
5. Deploy: `wrangler deploy`

### 3. Configure the Plugin

In the Sheets to Layers plugin settings, enter your worker URL:
```
https://your-worker-name.your-subdomain.workers.dev
```

## API Reference

The Worker accepts `GET` and `OPTIONS` requests. Responses include permissive CORS headers so the Figma UI can call the endpoint. Spreadsheet IDs must be 20–200 characters using letters, numbers, `_`, or `-`. Sheet responses are limited to 5 MiB and 100,000 cells per worksheet. Upstream requests time out after 15 seconds. These limits are enforced by the Worker source; the optional Cloudflare binding is the separate per-client rate cap.

### Get Worksheets (Discovery)

```
GET /?sheetId=<SPREADSHEET_ID>
```

Response:
```json
{
  "sheets": [
    { "title": "Sheet1", "sheetId": 0, "index": 0 },
    { "title": "Products", "sheetId": 123456, "index": 1 }
  ]
}
```

### Get Worksheet Data (Extraction)

```
GET /?sheetId=<SPREADSHEET_ID>&tabName=<WORKSHEET_NAME>
```

Response:
```json
{
  "tabName": "Products",
  "values": [
    ["Name", "Price", "Stock"],
    ["Widget", "9.99", "100"],
    ["Gadget", "19.99", "50"]
  ]
}
```

### Proxy Image

```
GET /?imageUrl=<ENCODED_IMAGE_URL>
```

Response: Raw image data with CORS headers

Image URLs must use HTTPS and cannot include credentials. The Worker rejects obvious private, local, configured self, and known proxy hosts, follows at most three HTTPS redirects, and accepts only PNG, JPEG, or GIF data. These hostname checks do not provide complete DNS-rebinding or destination-address protection. The response limit is 20 MiB. Requests with image parameters cannot include sheet parameters.

## Security Notes

- The API key is stored as an encrypted environment variable
- Restrict the API key to the Google Sheets API and rotate it if it is exposed
- The worker accepts GET and CORS preflight OPTIONS requests; other methods return 405
- `RATE_LIMITER` is optional; the maintained config uses a 600-request-per-minute binding per client key. Custom deployments should choose and document their own limit.
- Images are cached for 24 hours to reduce load
- The plugin limits its own concurrency to three worksheet tasks, four image requests, and six upstream requests. These limits do not rate-limit a public Worker endpoint; configure Cloudflare controls for that.
