// pages/api/esim/sync-shopee-map.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import PLAN_ID_MAP from "../../../lib/esim/planMap";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  try {
    // 先把 esim_plans 抓成 map（channel_dataplan_id -> active_type）
    const { data: plans, error: plansErr } = await supabase
      .from("esim_plans")
      .select("channel_dataplan_id, active_type");

    if (plansErr) throw plansErr;

    const activeTypeMap = new Map(
      (plans || []).map((p: any) => [p.channel_dataplan_id, p.active_type])
    );

    const rows = Object.entries(PLAN_ID_MAP).map(
      ([shopee_sku, channel_dataplan_id]) => ({
        shopee_sku,
        channel_dataplan_id: String(channel_dataplan_id),
        active_type: activeTypeMap.get(String(channel_dataplan_id)) || null,
        updated_at: new Date().toISOString(),
      })
    );

    const { error } = await supabase
      .from("shopee_plan_map")
      .upsert(rows, { onConflict: "shopee_sku" });

    if (error) throw error;

    return res.status(200).json({ ok: true, count: rows.length });
  } catch (e: any) {
    console.error("❌ sync-shopee-map failed:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
