// components/context/UserContext.js
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const UserContext = createContext({
  token: null,
  userInfo: null,
  isHydrated: false,   // ✅ Hydration 完成標記（消費端可用來避免閃爍）
  isFetching: false,   // 正在向後端拉使用者資訊
  setAuth: () => {},   // 登入後一次設定 token + user（並持久化）
  refresh: () => {},   // 重新向後端拉 /users/me
  logout: () => {},    // 登出（清理 token/user + 本地緩存）
});

export const UserProvider = ({ children }) => {
  const API_BASE_URL = process.env.NEXT_PUBLIC_WP_API_BASE_URL;

  // ✅ 以同步函式初始化，首幀就有 localStorage 的值（避免先顯示登出態）
  const [token, setToken] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("token") || null;
    } catch {
      return null;
    }
  });

  const [userInfo, setUserInfo] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [isHydrated, setIsHydrated] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  // ✅ Hydration 完成
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // ✅ 有 token 才取 /users/me，取到就覆蓋本地 user 緩存
  const fetchUserInfo = async (jwt) => {
    if (!jwt) return;
    setIsFetching(true);
    try {
      const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`❌ fetchUserInfo failed: ${res.status} ${text}`);
        // Token 失效時，主動登出
        if (res.status === 401 || res.status === 403) logout();
        return;
      }

      const data = await res.json();
      if (!data?.code) {
        setUserInfo(data);
        try {
          localStorage.setItem("user", JSON.stringify(data));
        } catch {}
      } else {
        console.warn("⚠️ Unexpected response:", data);
      }
    } catch (err) {
      console.error("❌ Network error in fetchUserInfo:", err);
    } finally {
      setIsFetching(false);
    }
  };

  // 首次掛載：若已有 token，背景刷新一次 user（UI 仍以本地快照顯示，不閃）
  useEffect(() => {
    if (token) fetchUserInfo(token);
    // 監聽跨分頁同步（選用）
    const onStorage = (e) => {
      if (e.key === "token") setToken(e.newValue);
      if (e.key === "user") {
        try {
          setUserInfo(e.newValue ? JSON.parse(e.newValue) : null);
        } catch {
          setUserInfo(null);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ 統一登入後設定（把 token & user 都寫入 context + localStorage）
  const setAuth = (nextToken, nextUser = null) => {
    try {
      if (nextToken) localStorage.setItem("token", nextToken);
      else localStorage.removeItem("token");
    } catch {}
    setToken(nextToken || null);

    if (nextUser) {
      setUserInfo(nextUser);
      try {
        localStorage.setItem("user", JSON.stringify(nextUser));
      } catch {}
    } else if (!nextToken) {
      // 無 token 代表登出
      setUserInfo(null);
      try {
        localStorage.removeItem("user");
      } catch {}
    }
  };

  // ✅ 重新向後端拉 user（例如登入剛完成、或你想強制同步）
  const refresh = () => {
    if (token) fetchUserInfo(token);
  };

  // ✅ 登出：同步清掉快照 + context
  const logout = () => {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch {}
    setToken(null);
    setUserInfo(null);
    console.log("🔓 Logged out");
  };

  const value = useMemo(
    () => ({
      token,
      userInfo,
      isHydrated,
      isFetching,
      setAuth,
      refresh,
      logout,
    }),
    [token, userInfo, isHydrated, isFetching]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = () => useContext(UserContext);
