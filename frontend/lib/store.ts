import { configureStore } from "@reduxjs/toolkit";
import Cookies from "js-cookie";
import authReducer from "./features/auth/authSlice";
import chatReducer from "./features/chat/chatSlice";
import agentReducer from "./features/agent/agentSlice";
import dashboardReducer from "./features/dashboard/dashboardSlice";
import issueReducer from "./features/issue/issueSlice";

const loadState = () => {
  try {
    if (typeof window === "undefined") return undefined;

    // The real token cookie is HttpOnly — JS cannot read it.
    // session_exists is a non-HttpOnly companion the backend sets alongside the token.
    // If it's absent, there's no active session; skip fetchProfile.
    const hasSession = Cookies.get("session_exists");
    if (!hasSession) return undefined;

    return {
      auth: {
        user: null, // Profile must be fetched via fetchProfile using the HttpOnly cookie
        status: "idle" as const,
        error: null,
      },
    };
  } catch {
    return undefined;
  }
};

export const makeStore = () => {
  const preloadedState = loadState();
  return configureStore({
    reducer: {
      auth: authReducer,
      chat: chatReducer,
      agent: agentReducer,
      dashboard: dashboardReducer,
      issue: issueReducer,
    },
    preloadedState,
  });
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
