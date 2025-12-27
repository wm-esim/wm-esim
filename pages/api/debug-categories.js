export default async function handler(req, res) {
  try {
    const r = await fetch(process.env.CATEGORY_API_URL);
    const txt = await r.text();
    res.status(200).json({
      status: r.status,
      ok: r.ok,
      bodyHead: txt.slice(0, 500),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
