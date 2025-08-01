"use client";

import React, { useState, useEffect } from "react";
import { useCart } from "../components/context/CartContext";
import Image from "next/image";
import { motion } from "framer-motion";
import Layout from "./Layout.js";

// ✅ 新增 SKU 對照轉換函式
const getPlanIdFromSku = (sku) => {
  const rawSkuToPlanId = {
    "MY-1DAY-DAILY500MB": "Malaysia-Daily500MB-1-A0",
    // 可擴充其他 SKU 對照
  };
  const cleaned = sku
    ?.trim()
    .replace(/\u200B/g, "")
    .toUpperCase();
  return rawSkuToPlanId[cleaned] || null;
};

const CheckoutPage = ({ onBack, onNext }) => {
  const { cartItems, totalPrice, removeFromCart, updateQuantity } = useCart();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    paymentMethod: "Credit",
    shippingMethod: "宅配",
    storeInfo: null,
  });

  const [memberInfo, setMemberInfo] = useState(null);
  const [useMemberInfo, setUseMemberInfo] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storeData = localStorage.getItem("ecpay_cvs_store");
      if (storeData) {
        setFormData((prev) => ({
          ...prev,
          storeInfo: JSON.parse(storeData),
        }));
      }

      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        setMemberInfo(JSON.parse(savedUser));
      }
    }
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.phone) {
      alert("請填寫所有必填欄位");
      return;
    }

    if (cartItems.length === 0) {
      alert("購物車為空，無法結帳");
      return;
    }

    const newWindow = window.open("about:blank");

    try {
      const enrichedItems = cartItems.map((item) => {
        const resolvedPlanId = item.planId || getPlanIdFromSku(item.sku);
        console.log("🧪 商品名稱:", item.name);
        console.log("🧪 原始 SKU:", item.sku);
        console.log("🧪 對應 planId:", resolvedPlanId);
        if (!resolvedPlanId) {
          console.warn("⚠️ 缺少 planId，請確認商品 SKU 與對照表一致", item);
        }
        return {
          ...item,
          planId: resolvedPlanId,
        };
      });

      const res = await fetch("/api/newebpay-generate-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: enrichedItems, orderInfo: formData }),
      });

      const html = await res.text();
      newWindow.document.write(html);
      newWindow.document.close();

      if (onNext) onNext();
    } catch (err) {
      console.error("❌ 建立訂單失敗", err);
      newWindow.close();
      alert("送出失敗，請稍後再試");
    }
  };

  const handleLinePaySubmit = async () => {
    if (!formData.name || !formData.email || !formData.phone) {
      alert("請填寫所有必填欄位");
      return;
    }

    if (cartItems.length === 0) {
      alert("購物車為空，無法結帳");
      return;
    }

    try {
      const enrichedItems = cartItems.map((item) => {
        const resolvedPlanId = item.planId || getPlanIdFromSku(item.sku);
        console.log("🧪 商品名稱:", item.name);
        console.log("🧪 原始 SKU:", item.sku);
        console.log("🧪 對應 planId:", resolvedPlanId);
        if (!resolvedPlanId) {
          console.warn("⚠️ 缺少 planId，請確認商品 SKU 與對照表一致", item);
        }
        return {
          ...item,
          planId: resolvedPlanId,
        };
      });

      const res = await fetch("/api/linepay/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderInfo: formData,
          cartItems: enrichedItems,
          totalPrice,
        }),
      });

      const json = await res.json();
      if (json?.info?.paymentUrl?.web) {
        window.location.href = json.info.paymentUrl.web;
        if (onNext) onNext();
      } else {
        console.error("LINE Pay API 回傳錯誤", json);
        alert("LINE Pay 串接失敗，請查看 Console");
      }
    } catch (err) {
      console.error("LINE Pay 發生錯誤", err);
      alert("LINE Pay 串接失敗");
    }
  };

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="bg-[#f5f6f7] pb-[80px]">
          {/* 省略表單與 UI 區塊... */}
        </div>
      </motion.div>
    </Layout>
  );
};

export default CheckoutPage;
