// pages/api/esim/qrcode.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import crypto from "crypto";
import FormData from "form-data";
import PLAN_ID_MAP from "../../../lib/esim/planMap";
import { createClient } from "@supabase/supabase-js";

// ✅ env
const ACCOUNT = process.env.ESIM_ACCOUNT!;
const SECRET = process.env.ESIM_SECRET!;
const SALT_HEX = process.env.ESIM_SALT!;
const BASE_URL = process.env.ESIM_BASE_URL || "https://microesim.top";

// ✅ Supabase（server-side only）
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function signHeaders() {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(6).toString("hex");
  const hexKey = crypto
    .pbkdf2Sync(SECRET, Buffer.from(SALT_HEX, "hex"), 1024, 32, "sha256")
    .toString("hex");

  const dataToSign = ACCOUNT + nonce + timestamp;
  const signature = crypto
    .createHmac("sha256", Buffer.from(hexKey, "utf8"))
    .update(dataToSign)
    .digest("hex");

  return { timestamp, nonce, signature };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const rawPlanId = req.body.channel_dataplan_id || req.body.planId;
  const number = req.body.number || req.body.quantity;

  if (!rawPlanId || !number) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // =========================
  // ✅ Lazy fetch dataplan list（避免重複打官方清單）
  //    這裡把型別鎖死成 any[]，解掉 list.find 紅底線
  // =========================
  let dataplanList: any[] = [];

  const getDataplanList = async (): Promise<any[]> => {
    if (dataplanList.length) return dataplanList;

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

    dataplanList = (listRes.data?.result ?? []) as any[];
    return dataplanList;
  };

  // =========================
  // ✅ 先查 shopee_plan_map（用 rawPlanId 查）
  // =========================
  let mapped: { channel_dataplan_id?: string; active_type?: string } | null = null;

  try {
    const { data } = await supabase
      .from("shopee_plan_map")
      .select("channel_dataplan_id, active_type")
      .eq("shopee_sku", rawPlanId)
      .maybeSingle();

    mapped = data;
  } catch (e: any) {
    console.warn("⚠️ Supabase lookup failed, will fallback:", e?.message);
  }

  // =========================
  // ✅ 再做 PLAN_ID_MAP / 原值 fallback
  // =========================
  const plan_code =
    mapped?.channel_dataplan_id ||
    PLAN_ID_MAP[rawPlanId] ||
    rawPlanId; // rawPlanId 也可能本來就是 channel_dataplan_id

  let channel_dataplan_id: string = plan_code;
  let active_type: string | null = mapped?.active_type || null;

  if (mapped?.channel_dataplan_id) {
    console.log(
      "✅ Using shopee_plan_map:",
      rawPlanId,
      mapped.channel_dataplan_id,
      mapped.active_type
    );
  } else if (PLAN_ID_MAP[rawPlanId]) {
    console.log("ℹ️ Using PLAN_ID_MAP fallback:", rawPlanId, plan_code);
  } else {
    console.log("ℹ️ No mapping found, treat as official plan id:", rawPlanId);
  }

  // =========================
  // ✅ active_type fallback（只在 null 時才查 list）
  // =========================
  if (!active_type) {
    try {
      const list = await getDataplanList();
      const found = list.find(
        (item: any) => item.channel_dataplan_id === channel_dataplan_id
      );

      if (found?.active_type) {
        active_type = found.active_type;
        console.log("✅ active_type from list:", active_type);
      } else {
        console.warn("⚠️ list 找不到 active_type，可能導致 subscribe 400");
      }
    } catch {
      console.warn("⚠️ 無法取得方案清單，active_type 維持 null");
    }
  }

  // 最後保底
  if (!active_type) active_type = "ACTIVEDBYDEVICE";

  // =========================
  // ✅ subscribe 前：驗證 UUID 仍存在官方清單
  // =========================
  try {
    const list = await getDataplanList();
    const exists = list.some(
      (item: any) => item.channel_dataplan_id === channel_dataplan_id
    );

    if (!exists) {
      return res.status(400).json({
        error: "Mapping 指到的方案已不存在官方清單",
        channel_dataplan_id,
        planId: rawPlanId,
      });
    }
  } catch {
    console.warn("⚠️ 無法驗證官方清單，仍繼續 subscribe");
  }

  // =========================
  // ✅ subscribe
  // =========================
  const { timestamp, nonce, signature } = signHeaders();

  const form = new FormData();
  form.append("number", number);
  form.append("channel_dataplan_id", channel_dataplan_id);

  // ✅ ACTIVEDBYORDER 一定要送 activation_date（補秒）
  if (active_type === "ACTIVEDBYORDER") {
    const now = new Date(Date.now() + 5 * 60 * 1000);
    const activationDate = now
      .toISOString()
      .replace("T", " ")
      .substring(0, 19); // YYYY-MM-DD HH:mm:ss
    form.append("activation_date", activationDate);
  }

  const headers = {
    ...form.getHeaders(),
    "MICROESIM-ACCOUNT": ACCOUNT,
    "MICROESIM-NONCE": nonce,
    "MICROESIM-TIMESTAMP": timestamp,
    "MICROESIM-SIGN": signature,
  };

  try {
    const subscribeRes = await axios.post(
      `${BASE_URL}/allesim/v1/esimSubscribe`,
      form,
      { headers, timeout: 10000 }
    );

    const result = subscribeRes.data;

    if (result.code === 1 && result.result?.topup_id) {
      const topup_id = result.result.topup_id;

      // =========================
      // ✅ topupDetail
      // =========================
      const { timestamp, nonce, signature } = signHeaders();
      const detailForm = new FormData();
      detailForm.append("topup_id", topup_id);

      const detailRes = await axios.post(
        `${BASE_URL}/allesim/v1/topupDetail`,
        detailForm,
        {
          headers: {
            ...detailForm.getHeaders(),
            "MICROESIM-ACCOUNT": ACCOUNT,
            "MICROESIM-NONCE": nonce,
            "MICROESIM-TIMESTAMP": timestamp,
            "MICROESIM-SIGN": signature,
          },
          timeout: 10000,
        }
      );

      const detail = detailRes.data;

      if (detail.code === 1 && detail.result?.qrcode) {
        return res.status(200).json({ topup_id, qrcode: detail.result.qrcode });
      } else {
        return res.status(200).json({
          topup_id,
          warning: "訂單成功但無 QRCode",
          detail,
        });
      }
    } else {
      return res.status(400).json({ error: result.msg, raw: result });
    }
  } catch (err: any) {
    const upstream = err?.response?.data || null;
    console.error("❌ 訂單建立錯誤:", upstream || err.message);

    return res.status(err?.response?.status || 500).json({
      error: "訂單建立失敗",
      detail: upstream || err.message,
    });
  }
}
