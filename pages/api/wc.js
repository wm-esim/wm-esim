// pages/api/wc.js
export default async function handler(req, res) {
  try {
    const { endpoint, query = "" } = req.query;

    const WC_BASE = process.env.WC_BASE_URL;
    const CK = process.env.WC_CONSUMER_KEY;
    const CS = process.env.WC_CONSUMER_SECRET;

    if (!WC_BASE || !CK || !CS) {
      return res.status(500).json({
        error: "Missing env vars",
        missing: {
          WC_BASE_URL: !WC_BASE,
          WC_CONSUMER_KEY: !CK,
          WC_CONSUMER_SECRET: !CS,
        },
      });
    }

    if (!endpoint) {
      return res.status(400).json({ error: "Missing endpoint" });
    }

    const safeEndpoint = String(endpoint).replace(/^\/+/, "");
    if (!safeEndpoint.startsWith("wc/v3/")) {
      return res.status(400).json({
        error: "Invalid endpoint. Must start with wc/v3/",
        got: safeEndpoint,
      });
    }

    const url = new URL(`${WC_BASE}/wp-json/${safeEndpoint}`);
    url.searchParams.set("consumer_key", CK);
    url.searchParams.set("consumer_secret", CS);

    if (query) {
      const extra = new URLSearchParams(String(query));
      for (const [k, v] of extra.entries()) url.searchParams.set(k, v);
    }

    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const text = await r.text();

    res.status(r.status);

    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.send(text);
    }
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
