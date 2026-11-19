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

[`wrangler.jsonc`](wrangler.jsonc) is the only deployment configuration; don't add a second `wrangler.toml` beside it. It sets the compatibility date, observability with query strings redacted, `KNOWN_SELF_HOSTS`, and the `RATE_LIMITER` binding (600 requests per 60 seconds per client).

**The maintained Worker** (`sheets-proxy` on the maintainer's account) deploys through Workers Builds: once the repository is connected in the Cloudflare dashboard, each push to `main` that changes `worker/` runs `npx wrangler deploy` from this folder. Until that connection is made, a merged change goes live only when the maintainer deploys by hand.

**Your own copy:** in `wrangler.jsonc`, change `name`, `account_id`, `KNOWN_SELF_HOSTS` (your Worker's hostname) and the rate-limit `namespace_id` (any positive integer unique in your account). Then, from this folder:

```sh
npx wrangler login
npx wrangler secret put GOOGLE_API_KEY
npx wrangler deploy
```

The rate-limit binding needs Wrangler 4.36.0 or newer ([reference](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)). It is optional: without it the Worker still enforces its request and response limits, but a public endpoint has no per-client cap. Secrets are encrypted and can't be read back once set ([Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)). Check the endpoint answers before pointing the plugin at it.

### 3. Configure the Plugin

The published plugin uses its hosted Worker automatically and does not expose connection settings. For a private development build, replace `DEFAULT_WORKER_URL` in `src/core/worker-fetcher.ts` with your deployed HTTPS endpoint, then rebuild the plugin.

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
