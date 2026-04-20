export interface AuthResponse {
  user_id: string;
  username: string;
  role: string;
  must_reset_password: boolean;
  is_active: boolean;
  last_login?: string | null;
  deleted_at?: string | null;
}

export interface ApiError {
  error: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
