import api from "@/lib/axios";

interface CreateUserPayload {
  username: string;
  email: string;
  password: string;
  role: string;
  must_reset_password: boolean;
}

export interface OpenRouterModel {
  uuid: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  selection_hint?: string | null;
  advanced_info?: string | null;
  context_length: number;
  input_price: number;
  output_price: number;
  is_reasoning: boolean;
  is_active: boolean;
  icon?: string | null;
}

export interface UpsertOpenRouterModelPayload {
  id: string;
  name: string;
  description: string;
  tags: string[];
  selection_hint: string;
  advanced_info: string;
  context_length: number;
  input_price: number;
  output_price: number;
  is_reasoning: boolean;
  is_active: boolean;
  icon?: string | null;
  icon_file?: File | null;
}

const getAdminErrorMessage = (
  error: unknown,
  fallback: string,
) =>
  (error as { response?: { data?: { error?: string } } })?.response?.data
    ?.error || fallback;

type RawOpenRouterModel = Omit<OpenRouterModel, "tags" | "icon"> & {
  tags?: string[] | null;
  tag?: string | null;
  icon?: string | null;
};

const normalizeTags = (value?: string[] | string | null) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  return rawValues.reduce<string[]>((tags, rawValue) => {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      return tags;
    }

    if (tags.some((tag) => tag.toLowerCase() === trimmedValue.toLowerCase())) {
      return tags;
    }

    tags.push(trimmedValue);
    return tags;
  }, []);
};

const normalizeOpenRouterModel = (model: RawOpenRouterModel): OpenRouterModel => ({
  ...model,
  tags: normalizeTags(model.tags ?? model.tag),
  icon: model.icon ?? null,
});

export const getAllUsers = async () => {
  try {
    const response = await api.get("/users");
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const createUser = async (userData: CreateUserPayload) => {
  try {
    const response = await api.post("/users", userData);
    return response.data;
  } catch (error: unknown) {
    const msg = getAdminErrorMessage(error, "Failed to create user");
    throw new Error(msg);
  }
};

export const changePassword = async (
  oldPassword: string,
  newPassword: string,
) => {
  try {
    const response = await api.post("/users/change-password", {
      old_password: oldPassword,
      new_password: newPassword,
    });
    return response.data;
  } catch (error: unknown) {
    const msg = getAdminErrorMessage(error, "Failed to change password");
    throw new Error(msg);
  }
};

export const deleteUser = async (userId: string) => {
  try {
    await api.delete(`/users/${userId}`);
    return true;
  } catch (error: unknown) {
    const msg = getAdminErrorMessage(error, "Failed to delete user");
    throw new Error(msg);
  }
};

export const forcePasswordReset = async (userId: string) => {
  try {
    await api.post(`/users/${userId}/reset`, {});
    return true;
  } catch (error: unknown) {
    const msg = getAdminErrorMessage(error, "Failed to force password reset");
    throw new Error(msg);
  }
};

export const getOpenRouterModels = async () => {
  try {
    const response = await api.get<{ models: RawOpenRouterModel[] }>(
      "/openrouter-models",
    );
    return response.data.models.map(normalizeOpenRouterModel);
  } catch (error: unknown) {
    throw new Error(getAdminErrorMessage(error, "Failed to fetch models"));
  }
};

export const getOpenRouterModel = async (uuid: string) => {
  try {
    const response = await api.get<{ model: RawOpenRouterModel }>(
      `/openrouter-models/${uuid}`,
    );
    return normalizeOpenRouterModel(response.data.model);
  } catch (error: unknown) {
    throw new Error(getAdminErrorMessage(error, "Failed to fetch model"));
  }
};

export const createOpenRouterModel = async (
  payload: UpsertOpenRouterModelPayload,
) => {
  try {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (key === "tags" && Array.isArray(value)) {
        value.forEach((tag) => formData.append("tags", tag));
        formData.append("tag", value[0] ?? "");
      } else if (key === "icon_file" && value instanceof File) {
        formData.append("icon_file", value);
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    const response = await api.post<{ model: RawOpenRouterModel }>(
      "/openrouter-models",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return normalizeOpenRouterModel(response.data.model);
  } catch (error: unknown) {
    throw new Error(getAdminErrorMessage(error, "Failed to create model"));
  }
};

export const updateOpenRouterModel = async (
  uuid: string,
  payload: UpsertOpenRouterModelPayload,
) => {
  try {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (key === "tags" && Array.isArray(value)) {
        value.forEach((tag) => formData.append("tags", tag));
        formData.append("tag", value[0] ?? "");
      } else if (key === "icon_file" && value instanceof File) {
        formData.append("icon_file", value);
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    const response = await api.put<{ model: RawOpenRouterModel }>(
      `/openrouter-models/${uuid}`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return normalizeOpenRouterModel(response.data.model);
  } catch (error: unknown) {
    throw new Error(getAdminErrorMessage(error, "Failed to update model"));
  }
};

export const deleteOpenRouterModel = async (uuid: string) => {
  try {
    await api.delete(`/openrouter-models/${uuid}`);
  } catch (error: unknown) {
    throw new Error(getAdminErrorMessage(error, "Failed to delete model"));
  }
};
