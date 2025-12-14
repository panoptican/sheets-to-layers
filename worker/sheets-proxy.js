/**
 * Cloudflare Worker: Google Sheets Proxy
 *
 * This worker acts as a proxy for Google Sheets API requests,
 * handling CORS and authentication.
 *
 * Modes:
 * 1. Discovery: Get list of worksheets (no tabName param)
 * 2. Extraction: Get data for a specific worksheet (with tabName param)
 * 3. Image proxy: Fetch images with CORS headers (with imageUrl param)
 *
 * Environment Variables Required:
 * - GOOGLE_API_KEY: Your Google Sheets API key
 *
 * Deploy:
 * 1. Create a Cloudflare Worker
 * 2. Add GOOGLE_API_KEY as an environment variable
 * 3. Deploy this code
 * 4. Use the worker URL in the plugin settings
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const sheetId = url.searchParams.get("sheetId");
    const tabName = url.searchParams.get("tabName");
    const imageUrl = url.searchParams.get("imageUrl");
    const apiKey = env.GOOGLE_API_KEY;

    // CORS headers for Figma plugin
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Mode 3: Image proxy
    if (imageUrl) {
      return proxyImage(imageUrl, corsHeaders);
    }

    // Validate required params for sheet operations
    if (!sheetId) {
      return new Response(
        JSON.stringify({ error: "Missing sheetId parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: missing API key" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      let googleUrl;

      if (tabName) {
        // Mode 2: Fetch cell values for a specific tab
        const encodedTab = encodeURIComponent(tabName);
        googleUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodedTab}?key=${apiKey}`;
      } else {
        // Mode 1: Fetch spreadsheet metadata (list of sheets)
        googleUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties&key=${apiKey}`;
      }

      const response = await fetch(googleUrl);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = "Failed to fetch from Google Sheets";

        if (response.status === 403) {
          errorMessage = "Sheet is not publicly accessible or API key is invalid";
        } else if (response.status === 404) {
          errorMessage = "Spreadsheet not found";
        }

        return new Response(
          JSON.stringify({ error: errorMessage, status: response.status, details: errorText }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();

      // Transform the response based on mode
      let result;
      if (tabName) {
        // Mode 2: Return values as 2D array
        result = {
          tabName: tabName,
          values: data.values || [],
        };
      } else {
        // Mode 1: Return list of sheet names
        result = {
          sheets: data.sheets.map(s => ({
            title: s.properties.title,
            sheetId: s.properties.sheetId,
            index: s.properties.index,
          })),
        };
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message || "Unknown error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};

/**
 * Proxy an image request with CORS headers
 */
async function proxyImage(imageUrl, corsHeaders) {
  try {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch image: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    const imageData = await response.arrayBuffer();

    return new Response(imageData, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400", // Cache for 24 hours
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Image proxy error: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
