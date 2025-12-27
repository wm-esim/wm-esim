// pages/api/wc.js

export default async function handler(req, res) {
  try {
    const { endpoint, query = "" } = req.query;

    if (!endpoint) {
      return res.status(400).json({ error: "Missing endpoint" });
    }

    const WC_BASE = process.env.WC_BASE_URL; // e.g. https://fegoesim.com
    const CK = process.env.WC_CONSUMER_KEY;
    const CS = process.env.WC_CONSUMER_SECRET;

    if (!WC_BASE || !CK || !CS) {
      return res.status(500).json({
        error: "Missing env vars: WC_BASE_URL / WC_CONSUMER_KEY / WC_CONSUMER_SECRET",
      });
    }

    // 只允許 wc/v3 底下的路徑，避免 SSRF
    const safeEndpoint = String(endpoint).replace(/^\/+/, "");
    if (!safeEndpoint.startsWith("wc/v3/")) {
      return res.status(400).json({ error: "Invalid endpoint. Must start with wc/v3/" });
    }

    const url = new URL(`${WC_BASE}/wp-json/${safeEndpoint}`);
    url.searchParams.set("consumer_key", CK);
    url.searchParams.set("consumer_secret", CS);

    // query 允許傳入 "per_page=100&page=1" 這種字串
    if (query) {
      const extra = new URLSearchParams(String(query));
      for (const [k, v] of extra.entries()) {
        url.searchParams.set(k, v);
      }
    }

    const r = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
    });

    const text = await r.text();

    // 轉回原 status，方便你在前端/Logs 看
    res.status(r.status);

    // 嘗試 JSON parse，不是 JSON 就原樣回傳
    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.send(text);
    }
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
