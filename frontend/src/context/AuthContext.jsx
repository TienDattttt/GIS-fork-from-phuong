import { createContext, startTransition, useContext, useEffect, useMemo, useState } from "react";

import { apiClient, authHeaders } from "../api/client";

const AuthContext = createContext(null);

function readStoredUser() {
  const raw = localStorage.getItem("user");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(() => readStoredUser());
  const [ready, setReady] = useState(false);

  const saveAuth = (nextToken, nextUser) => {
    localStorage.setItem("token", nextToken);
    localStorage.setItem("user", JSON.stringify(nextUser));
    startTransition(() => {
      setToken(nextToken);
      setUser(nextUser);
    });
  };

  const clearAuth = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    startTransition(() => {
      setToken(null);
      setUser(null);
    });
  };

  const verify = async () => {
    if (!token) {
      setReady(true);
      return false;
    }
    try {
      const response = await apiClient.get("/auth/me", {
        headers: authHeaders(token)
      });
      const nextUser = response.data?.data?.user;
      if (nextUser) {
        localStorage.setItem("user", JSON.stringify(nextUser));
        startTransition(() => setUser(nextUser));
      }
      setReady(true);
      return true;
    } catch {
      clearAuth();
      setReady(true);
      return false;
    }
  };

  useEffect(() => {
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username, password) => {
    const response = await apiClient.post("/auth/login", { username, password });
    const payload = response.data?.data;
    saveAuth(payload.token, payload.user);
    return payload;
  };

  const register = async (input) => {
    const response = await apiClient.post("/auth/register", input);
    return response.data?.data;
  };

  const resendVerificationEmail = async (input) => {
    const response = await apiClient.post("/auth/verify-email/resend", input);
    return response.data?.data;
  };

  const verifyEmail = async (tokenValue) => {
    const response = await apiClient.post("/auth/verify-email", { token: tokenValue });
    return response.data?.data;
  };

  const forgotPassword = async (email) => {
    const response = await apiClient.post("/auth/forgot-password", { email });
    return response.data?.data;
  };

  const resetPassword = async (tokenValue, newPassword) => {
    const response = await apiClient.post("/auth/reset-password", {
      token: tokenValue,
      new_password: newPassword
    });
    return response.data?.data;
  };

  const logout = async () => {
    try {
      if (token) {
        await apiClient.post(
          "/auth/logout",
          {},
          {
            headers: authHeaders(token)
          }
        );
      }
    } finally {
      clearAuth();
    }
  };

  const logActivity = async (activityType, page, details = {}) => {
    if (!token) {
      return;
    }
    try {
      await apiClient.post(
        "/activity/log",
        { activityType, page, details },
        { headers: authHeaders(token) }
      );
    } catch {
      // ignore logging failures
    }
  };

  const value = useMemo(
    () => ({
      token,
      user,
      ready,
      isAuthenticated: Boolean(token),
      login,
      register,
      resendVerificationEmail,
      verifyEmail,
      forgotPassword,
      resetPassword,
      logout,
      verify,
      logActivity
    }),
    [token, user, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
