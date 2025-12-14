## 2024-05-23 - Hardcoded Google Sheets API Key
**Vulnerability:** A hardcoded Google Sheets API key was found in `src/core/sheet-fetcher.ts`.
**Learning:** Developers often embed keys for convenience in client-side apps, but this exposes the key to scraping and abuse.
**Prevention:** Use environment variables and build-time injection, or require user input for keys. In this case, we moved it to an environment variable check and default to undefined, relying on the existing fallback mechanism (JSONP probing) when the key is missing.
