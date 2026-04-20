import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { AuthResponse } from "@/types/auth";
import { loginUser, getProfile } from "./authAPI";
import api from "@/lib/axios";

interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthState {
  user: {
    id: string;
    username: string;
    role: string;
    mustResetPassword?: boolean;
    isActive?: boolean;
    lastLogin?: string | null;
    deletedAt?: string | null;
  } | null;
  status: "idle" | "loading" | "failed";
  error: string | null;
}

const getInitialState = (): AuthState => {
  // Authentication is cookie-only; JS never mirrors the JWT.
  return {
    user: null,
    status: "idle",
    error: null,
  };
};

const initialState: AuthState = getInitialState();

export const login = createAsyncThunk(
  "auth/login",
  async ({ email, password }: LoginPayload) => {
    return await loginUser(email, password);
  },
);

export const fetchProfile = createAsyncThunk("auth/me", async () => {
  return await getProfile();
});

export const logoutUser = createAsyncThunk("auth/logoutUser", async () => {
  await api.post("/auth/logout"); // backend clears HttpOnly cookie
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    logout: (state) => {
      state.user = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(
        login.fulfilled,
        (state, action: PayloadAction<AuthResponse>) => {
          state.status = "idle";
          state.user = {
            id: action.payload.user_id,
            username: action.payload.username,
            role: action.payload.role,
            mustResetPassword: action.payload.must_reset_password,
            lastLogin: action.payload.last_login,
          };
        },
      )
      .addCase(login.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message || "Login failed";
      })
      .addCase(fetchProfile.fulfilled, (state, action) => {
        state.user = {
          id: action.payload.user_id,
          username: action.payload.username,
          role: action.payload.role,
          mustResetPassword: action.payload.must_reset_password,
          isActive: action.payload.is_active,
          lastLogin: action.payload.last_login,
          deletedAt: action.payload.deleted_at,
        };
      })
      .addCase(fetchProfile.rejected, (state) => {
        // If fetching profile fails (e.g. invalid token not caught by middleware yet),
        // we might want to ensure user is null, but middleware handles redirects.
        state.user = null;
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
      })
      .addCase(logoutUser.rejected, (state) => {
        // Clear local state even if backend call fails
        state.user = null;
      });
  },
});

export const { logout } = authSlice.actions;
export const selectUser = (state: { auth: AuthState }) => state.auth.user;
export default authSlice.reducer;
