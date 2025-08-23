"use client";

import { createContext, useState, useContext, useEffect, useMemo } from "react";

const CartContext = createContext();

const LS_KEY = "cartItems";

// 安全讀取 localStorage
const readCartFromStorage = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// 安全寫入 localStorage
const writeCartToStorage = (items) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items ?? []));
  } catch {}
};

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState(() => readCartFromStorage());
  const [isOpen, setIsOpen] = useState(false);

  // 依據 cartItems 計算總價（以數字計）
  const totalPrice = useMemo(() => {
    return cartItems.reduce((acc, item) => {
      const price = Number(item.price) || 0;
      const qty = Number(item.quantity) || 0;
      return acc + price * qty;
    }, 0);
  }, [cartItems]);

  // 寫回 localStorage
  useEffect(() => {
    writeCartToStorage(cartItems);
  }, [cartItems]);

  // 跨分頁同步購物車
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === LS_KEY) {
        setCartItems(readCartFromStorage());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 加入購物車
  const addToCart = (product) => {
    // 若商品規格需要選擇但尚未選，直接 return
    if (("color" in product && !product.color) || ("size" in product && !product.size)) {
      return;
    }

    const qtyToAdd = Number(product.quantity) || 1;

    setCartItems((prevItems) => {
      const idx = prevItems.findIndex(
        (item) =>
          item.id === product.id &&
          (item.color ?? null) === (product.color ?? null) &&
          (item.size ?? null) === (product.size ?? null)
      );

      if (idx >= 0) {
        const copy = [...prevItems];
        const old = copy[idx];
        copy[idx] = { ...old, quantity: (Number(old.quantity) || 0) + qtyToAdd };
        return copy;
      }
      return [...prevItems, { ...product, quantity: qtyToAdd }];
    });

    setIsOpen(true);
  };

  // 移除品項
  const removeFromCart = (productId, color, size) => {
    setCartItems((prevItems) =>
      prevItems.filter(
        (item) =>
          !(
            item.id === productId &&
            (item.color ?? null) === (color ?? null) &&
            (item.size ?? null) === (size ?? null)
          )
      )
    );
  };

  // 更新數量（最少 1）
  const updateQuantity = (productId, color, size, newQuantity) => {
    const next = Math.max(1, Number(newQuantity) || 1);
    setCartItems((prevItems) =>
      prevItems.map((item) =>
        item.id === productId &&
        (item.color ?? null) === (color ?? null) &&
        (item.size ?? null) === (size ?? null)
          ? { ...item, quantity: next }
          : item
      )
    );
  };

  // 清空購物車（結帳成功後請呼叫這個）
  const clearCart = () => {
    setCartItems([]);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    setIsOpen(false);
  };

  return (
    <CartContext.Provider
      value={{
        cartItems,
        totalPrice,
        isOpen,
        setIsOpen,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart, // ✅ 結帳成功後記得呼叫
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => useContext(CartContext);
