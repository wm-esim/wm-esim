// pages/api/esim/sync-plans.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.ESIM_BASE_URL || "https://microesim.top";
const ACCOUNT = process.env.ESIM_ACCOUNT!;
const SECRET = process.env.ESIM_SECRET!;
const SALT_HEX = process.env.ESIM_SALT!;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function signHeaders() {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(6).toString("hex");
  const hexKey = crypto.pbkdf2Sync(
    SECRET,
    Buffer.from(SALT_HEX, "hex"),
    1024,
    32,
    "sha256"
  ).toString("hex");

  const dataToSign = ACCOUNT + nonce + timestamp;
  const signature = crypto
    .createHmac("sha256", Buffer.from(hexKey, "utf8"))
    .update(dataToSign)
    .digest("hex");

  return { timestamp, nonce, signature };
}

/** 將各種欄位安全轉成 number；轉不了回 null */
function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  const s = String(v).trim();

  // 例如 "Total20GB" / "20GB" / "20.5GB" / "USD 3.99"
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return null;

  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  if (!ACCOUNT || !SECRET || !SALT_HEX) {
    return res.status(500).json({
      ok: false,
      error: "Missing ESIM env vars (ESIM_ACCOUNT / ESIM_SECRET / ESIM_SALT)",
    });
  }

  try {
    const { timestamp, nonce, signature } = signHeaders();

    const listRes = await axios.get(`${BASE_URL}/allesim/v1/esimDataplanList`, {
      headers: {
        "Content-Type": "application/json",
        "MICROESIM-ACCOUNT": ACCOUNT,
        "MICROESIM-NONCE": nonce,
        "MICROESIM-TIMESTAMP": timestamp,
        "MICROESIM-SIGN": signature,
      },
      timeout: 15000,
    });

    const plans: any[] = listRes.data?.result || [];
    if (!plans.length) {
      return res.status(200).json({ ok: true, count: 0, message: "No plans returned" });
    }

    const rows = plans.map((p) => {
      const plan_code =
        p.sku ||
        p.plan_code ||
        p.channel_dataplan_id; // 保底

      return {
        plan_code,
        channel_dataplan_id: p.channel_dataplan_id,
        name: p.name || p.title || null,
        country: p.country || p.region || null,
        days: toNumberOrNull(p.days || p.valid_days),
        data_gb: toNumberOrNull(p.data_gb ?? p.data ?? p.total_data),
        active_type: p.active_type || null,
        price: toNumberOrNull(p.price),
        currency: p.currency || null,
        raw_json: p,
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from("esim_plans")
      .upsert(rows, { onConflict: "plan_code" });

    if (error) {
      console.error("❌ Supabase upsert error:", error);
      throw error;
    }

    return res.status(200).json({
      ok: true,
      count: rows.length,
      message: "Plans synced to Supabase",
    });
  } catch (e: any) {
    console.error("❌ sync-plans failed:", e?.response?.data || e.message);
    return res.status(500).json({
      ok: false,
      error: e.message,
      detail: e?.response?.data || null,
    });
  }
}
