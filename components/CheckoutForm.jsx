"use client";

import React, { useState, useEffect } from "react";
import { useCart } from "../components/context/CartContext";
import Image from "next/image";
import { motion } from "framer-motion";
import PLAN_ID_MAP from "../lib/esim/planMap"; // 根據實際路徑調整

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
        const cleanedSku = item.sku
          ?.trim()
          .replace(/\u200B/g, "") // 移除 Zero-Width Space
          .replace(/,/g, "-") // 逗號改為 -
          .replace(/\s+/g, "-") // 空格改為 -
          .replace(/-+/g, "-"); // 多個 - 合併成一個

        const resolvedPlanId = item.planId || PLAN_ID_MAP[cleanedSku];

        console.log("🛒 商品名稱:", item.name);
        console.log("🔍 SKU:", cleanedSku);
        console.log("✅ planId:", resolvedPlanId);

        if (!resolvedPlanId) {
          console.warn(
            "⚠️ 無法對應 planId，請確認 SKU 是否與 planMap 對上",
            item
          );
        }

        return {
          ...item,
          planId: resolvedPlanId,
        };
      });

      const res = await fetch("/api/newebpay-generate-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: enrichedItems,
          orderInfo: {
            ...formData,
            customerId: memberInfo?.id || 0,
          },
        }),
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
        const cleanedSku = item.sku
          ?.trim()
          .replace(/\u200B/g, "")
          .replace(/,/g, "-")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-");

        const resolvedPlanId = item.planId || PLAN_ID_MAP[cleanedSku];

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-[#f5f6f7] pb-[80px]">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col lg:flex-row max-w-7xl w-full my-[70px] mx-auto"
        >
          {/* 左側：填寫表單 */}
          <div className="w-full lg:w-1/2 flex justify-center bg-white p-5 sm:p-10 m-2 flex-col">
            <div className="max-w-[500px] flex flex-col mx-auto items-center">
              <h2 className="text-xl font-bold mb-4">結帳資訊</h2>

              <div className="flex items-center w-full mb-4">
                <input
                  type="checkbox"
                  id="useMember"
                  checked={useMemberInfo}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setUseMemberInfo(checked);
                    if (checked && memberInfo) {
                      setFormData((prev) => ({
                        ...prev,
                        name: memberInfo.name || "",
                        email: memberInfo.email || "",
                        phone: memberInfo.phone || "",
                      }));
                    }
                  }}
                  className="mr-2"
                />
                <label htmlFor="useMember" className="text-sm text-gray-700">
                  同會員資料自動填入
                </label>
              </div>

              <input
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="姓名"
                className="border p-2 w-full border-gray-300 rounded-[13px] mb-2"
                required
              />
              <input
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Email"
                className="border p-2 w-full border-gray-300 rounded-[13px] mb-2"
                required
              />
              <input
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="手機號碼"
                className="border p-2 w-full border-gray-300 rounded-[13px] mb-2"
                required
              />
              <div className="mt-2">
                <span className="text-[14px] text-gray-600">
                  備註：請填入正確的 Email，此 Email 會拿來當作發送 QR CODE
                  兌換的依據
                </span>
              </div>
            </div>
          </div>

          {/* 右側：購物車與付款 */}
          <div className="w-full lg:w-1/2 m-2 p-10 bg-white">
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                購物車內容
              </h3>
              {cartItems.length === 0 ? (
                <p className="text-gray-500">購物車是空的</p>
              ) : (
                <ul className="space-y-4">
                  {cartItems.map((item, index) => (
                    <li
                      key={index}
                      className="bg-[#f8f8fa] p-4 border-gray-200 border-2 flex flex-row rounded-[20px] items-center gap-4"
                    >
                      <Image
                        src={item.image}
                        alt={item.name}
                        width={80}
                        height={80}
                        className="rounded-xl max-w-[110px]"
                      />
                      <div className="flex flex-col w-full pl-5">
                        <span className="font-bold">{item.name}</span>
                        <span className="text-sm text-gray-600">
                          國家：{item.color} / 規格：{item.size}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          <label className="text-sm">數量：</label>
                          <input
                            type="number"
                            value={item.quantity}
                            min={1}
                            onChange={(e) =>
                              updateQuantity(
                                item.id,
                                item.color,
                                item.size,
                                parseInt(e.target.value)
                              )
                            }
                            className="w-16 rounded-[10px] px-2 py-1 text-sm border"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              removeFromCart(item.id, item.color, item.size)
                            }
                            className="text-red-500 hover:underline text-sm"
                          >
                            移除
                          </button>
                        </div>
                        <span className="text-sm font-medium mt-1">
                          小計：${item.price * item.quantity}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-right font-bold mt-4">總金額：${totalPrice}</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mt-6">
              <button
                type="submit"
                className="hover:bg-gray-900 bg-gray-800 text-white px-6 py-2 rounded-[10px] w-full"
              >
                使用藍新金流結帳
              </button>
              <button
                type="button"
                onClick={handleLinePaySubmit}
                className="hover:bg-green-700 bg-green-600 text-white px-6 py-2 rounded-[10px] w-full"
              >
                使用 LINE Pay 結帳
              </button>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={onBack}
                className="text-gray-600 underline text-sm"
              >
                ← 返回上一步
              </button>
            </div>
          </div>
        </form>
      </div>
    </motion.div>
  );
};

export default CheckoutPage;
