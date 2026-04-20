import axios from "axios";
import api from "@/lib/axios";
import { AuthResponse, ApiError } from "@/types/auth";

// API Client is now imported from @/lib/axios

export const loginUser = async (
  email: string,
  password: string,
): Promise<AuthResponse> => {
  try {
    const response = await api.post<AuthResponse>("/auth/login", {
      email,
      password,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const errorData = error.response.data as ApiError;
      throw new Error(errorData.error || "Login failed");
    } else {
      throw new Error("Network Error: Unable to reach the server");
    }
  }
};

export const getProfile = async (): Promise<AuthResponse> => {
  const response = await api.get<AuthResponse>("/auth/me");
  return response.data;
};
