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
5. (Recommended) Restrict the key to Google Sheets API only

### 2. Deploy to Cloudflare

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
3. Create `wrangler.toml`:
   ```toml
   name = "sheets-proxy"
   main = "sheets-proxy.js"
   compatibility_date = "2024-01-01"

   [vars]
   # Don't put API key here - use secrets instead
   ```
4. Add secret: `wrangler secret put GOOGLE_API_KEY`
5. Deploy: `wrangler deploy`

### 3. Configure the Plugin

In the Sheets Sync plugin settings, enter your worker URL:
```
https://your-worker-name.your-subdomain.workers.dev
```

## API Reference

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

## Security Notes

- The API key is stored as an encrypted environment variable
- Consider restricting your API key to specific referrers if needed
- The worker only allows GET requests
- Images are cached for 24 hours to reduce load
