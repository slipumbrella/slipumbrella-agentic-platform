import axios, { InternalAxiosRequestConfig } from "axios";

// 1. Read from Environment Variable
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api";

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // send HttpOnly cookie automatically
});

// Request interceptor — token is sent automatically via HttpOnly cookie (withCredentials: true)
api.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error),
);

// Response interceptor for 401 handling

interface FailedQueueItem {
  resolve: (value: string | null) => void;
  reject: (reason?: unknown) => void;
}

let isRefreshing = false;
let isLoggingOut = false;
let failedQueue: FailedQueueItem[] = [];

const processQueue = (error: unknown | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const handleLogout = async () => {
  if (isLoggingOut) return;
  isLoggingOut = true;
  try {
    await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true });
  } catch {
    // ignore — redirect regardless
  }
  if (typeof window !== "undefined") {
    window.location.href = "/login?error=unauthorized";
  }
};

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as CustomAxiosRequestConfig;

    // Check if error is 401, hasn't been retried yet, and is NOT a login/refresh request
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/login") &&
      !originalRequest.url?.includes("/auth/refresh")
    ) {
      if (isRefreshing) {
        return new Promise<string | null>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => api(originalRequest)) // cookie is refreshed automatically
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // 1. Attempt to refresh the token — backend updates HttpOnly cookie via Set-Cookie
        await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });

        processQueue(null, null);

        // 2. Retry the original request (cookie is updated automatically)
        return api(originalRequest);
      } catch (refreshError: unknown) {
        // 3. If refresh fails, THEN clear and redirect
        processQueue(refreshError, null);
        handleLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;
