// /pages/checkout/pending.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";

type OffsiteInfo = {
  PaymentType?: string;
  BankCode?: string;
  CodeNo?: string;
  PaymentNo?: string;
  StoreType?: string;
  ExpireDate?: string;
  TradeNo?: string;
  Amt?: number | string;
};

type ApiResp = {
  orderInfo: {
    status: string; // SUCCESS / PENDING / FAILED ...
    isPaid: boolean;
    MerchantOrderNo: string;
    PaymentType: string;
    PayTime?: string;
    TradeNo?: string;
    wooStatus: string;
  };
  offsiteInfo?: OffsiteInfo | null;
  offsitePending: boolean;
  qrcodes?: Array<{ name: string; src: string }>;
  message?: string;
  error?: string;
};

export default function PendingPage() {
  const router = useRouter();
  const { orderNo } = router.query as { orderNo?: string };
  const [data, setData] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<any>(null);

  const paymentType = useMemo(
    () =>
      (
        data?.orderInfo?.PaymentType ||
        data?.offsiteInfo?.PaymentType ||
        ""
      ).toUpperCase(),
    [data]
  );

  async function load() {
    if (!orderNo) return;
    try {
      setErr(null);
      const r = await fetch(
        `/api/fetch-order?orderNo=${encodeURIComponent(orderNo)}`
      );
      const j: ApiResp = await r.json();
      if (!r.ok) throw new Error(j?.error || "查詢失敗");
      setData(j);

      // 已付款就跳轉
      if (j?.orderInfo?.isPaid || j?.orderInfo?.status === "SUCCESS") {
        router.replace(`/thank-you?orderNo=${encodeURIComponent(orderNo)}`);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, [orderNo]);

  useEffect(() => {
    // 輪詢：尚未付款才輪詢
    if (
      data &&
      !(data.orderInfo?.isPaid || data.orderInfo?.status === "SUCCESS")
    ) {
      timerRef.current = setInterval(load, 12000); // 12 秒
      return () => clearInterval(timerRef.current);
    }
    return () => {};
  }, [data?.orderInfo?.isPaid, data?.orderInfo?.status]);

  const info = data?.offsiteInfo;
  const amount = info?.Amt ?? (data as any)?.total;

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "40px auto",
        padding: "0 16px",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Arial",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
        取號成功，請完成繳費
      </h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        訂單編號：<strong>{orderNo}</strong>
        {data?.orderInfo?.TradeNo ? (
          <>（交易序號：{data.orderInfo.TradeNo}）</>
        ) : null}
      </p>

      {err ? (
        <div
          style={{
            background: "#fff3f3",
            border: "1px solid #ffd6d6",
            padding: 12,
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          查詢失敗：{err}
        </div>
      ) : null}

      {!data ? (
        <div>載入中…</div>
      ) : !info ? (
        <div
          style={{
            background: "#fff7e6",
            border: "1px solid #ffe1b5",
            padding: 12,
            borderRadius: 8,
          }}
        >
          尚未取得取號資訊，請稍後再試。若已完成付款，頁面會自動更新。
        </div>
      ) : (
        <section
          style={{
            background: "#fafafa",
            border: "1px solid #eee",
            padding: 16,
            borderRadius: 12,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            付款方式：<strong>{paymentType || "OFFSITE"}</strong>
          </div>
          <div style={{ marginBottom: 12 }}>
            應繳金額：
            <strong>NT$ {Number(amount || 0).toLocaleString("zh-TW")}</strong>
          </div>

          {paymentType === "VACC" ? (
            <>
              <Row label="銀行代碼" value={info?.BankCode} copy />
              <Row label="轉帳帳號" value={info?.CodeNo} copy mono />
              <Row label="繳費期限" value={info?.ExpireDate} />
            </>
          ) : paymentType === "CVS" ? (
            <>
              <Row label="超商別" value={info?.StoreType} />
              <Row
                label="繳費代碼"
                value={info?.PaymentNo || info?.CodeNo}
                copy
                mono
              />
              <Row label="繳費期限" value={info?.ExpireDate} />
            </>
          ) : paymentType === "BARCODE" ? (
            <>
              <Row label="繳費條碼" value={info?.CodeNo} copy mono />
              <Row label="繳費期限" value={info?.ExpireDate} />
            </>
          ) : paymentType === "WEBATM" ? (
            <div>請依頁面提示完成 WebATM 交易。</div>
          ) : (
            <div>請依指示完成繳費。</div>
          )}

          <p style={{ color: "#666", marginTop: 16 }}>
            本頁會每 12 秒自動更新；完成繳費後會自動前往 Thank You 頁。
          </p>
        </section>
      )}
    </main>
  );
}

function Row({
  label,
  value,
  copy,
  mono,
}: {
  label: string;
  value?: string;
  copy?: boolean;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
    >
      <div style={{ width: 96, color: "#666" }}>{label}</div>
      <div
        style={{
          flex: 1,
          fontFamily: mono
            ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
            : undefined,
          fontSize: mono ? 16 : 15,
          background: "#fff",
          border: "1px solid #eee",
          padding: "8px 10px",
          borderRadius: 8,
        }}
      >
        {value}
      </div>
      {copy ? (
        <button
          onClick={() => navigator.clipboard.writeText(value)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          複製
        </button>
      ) : null}
    </div>
  );
}
