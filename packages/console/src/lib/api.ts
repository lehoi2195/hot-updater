import type { RpcType } from "@/src-server/rpc";
import { createQuery } from "@tanstack/solid-query";
import { hc } from "hono/client";
export const api = hc<RpcType>("/rpc");

import type { Accessor } from "solid-js";
const DEFAULT_CHANNEL = "production";

export const createBundlesQuery = (
  query: Accessor<{
    channel?: string;
    platform?: string;
    limit?: string;
    offset?: string;
  }>
) => {
  const result = createQuery(() => ({
    queryKey: ["bundles", query()],
    queryFn: async () => {
      const res = await api.bundles.$get({
        query: query() as any, // Ép kiểu để tránh lỗi TypeScript
      });
      return res.json();
    },
    placeholderData: (prev) => prev,
    staleTime: Number.POSITIVE_INFINITY,
  }));

  return [result];
};

export const createBundleQuery = (bundleId: string) =>
  createQuery(() => ({
    queryKey: ["bundle", bundleId],
    queryFn: () => {
      return api.bundles[":bundleId"]
        .$get({ param: { bundleId } })
        .then((res) => res.json());
    },
    placeholderData: (prev) => {
      return prev;
    },
    staleTime: Number.POSITIVE_INFINITY,
  }));

export const createConfigQuery = () =>
  createQuery(() => ({
    queryKey: ["config"],
    queryFn: () => api.config.$get().then((res) => res.json()),
    staleTime: Number.POSITIVE_INFINITY,
    retryOnMount: false,
  }));

export const createChannelsQuery = () =>
  createQuery(() => ({
    queryKey: ["channels"],
    queryFn: () => api.channels.$get().then((res) => res.json()),
    staleTime: Number.POSITIVE_INFINITY,
    retryOnMount: false,
    select: (data) => {
      if (!data || data.length === 0) {
        return null;
      }

      if (data.includes(DEFAULT_CHANNEL)) {
        return [
          DEFAULT_CHANNEL,
          ...data.filter((channel) => channel !== DEFAULT_CHANNEL),
        ];
      }

      return data;
    },
  }));

// Type cho response của deleteBundle
export type DeleteBundleResponse = {
  success?: boolean;
  partialSuccess?: boolean;
  message?: string;
  storageError?: string;
  error?: string;
  databaseSuccess?: boolean;
  r2Success?: boolean;
  r2Message?: string;
  d1Result?: any;
  r2Result?: any;
};

export const deleteBundle = async (
  bundleId: string
): Promise<DeleteBundleResponse> => {
  try {
    const response = await api.bundles[":bundleId"].$delete({
      param: { bundleId },
    });
    const data = await response.json();
    return {
      success: true,
      ...data,
    };
  } catch (error) {
    console.error("Error calling delete API:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// Thêm hàm mới này để vô hiệu hóa bundle mà không xóa từ storage
export const disableBundle = async (
  bundleId: string
): Promise<DeleteBundleResponse> => {
  try {
    const response = await api.bundles[":bundleId"].disable.$post({
      param: { bundleId },
    });
    const data = await response.json();
    return {
      success: true,
      ...data,
    };
  } catch (error) {
    console.error("Error calling disable API:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// Thêm hàm mới để xóa cả trong D1 và R2
export const completeDeleteBundle = async (
  bundleId: string
): Promise<DeleteBundleResponse> => {
  try {
    const response = await api.bundles[":bundleId"]["complete-delete"].$post({
      param: { bundleId },
    });
    const data = await response.json();
    return data as DeleteBundleResponse;
  } catch (error) {
    console.error("Error calling complete delete API:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// API để lấy kích thước file từ R2
export const fetchFileSizesFromR2 = async (
  bundleIds: string[]
): Promise<Record<string, number>> => {
  try {
    // Gọi API server để lấy kích thước các bundle
    const response = await fetch(`/rpc/bundle-sizes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bundleIds }),
    });

    if (!response.ok) {
      console.error("Error fetching bundle sizes:", response.statusText);
      return {};
    }

    const data = await response.json();

    if (data.success && data.fileSizes) {
      return data.fileSizes;
    }

    console.warn("No file sizes returned from API");
    return {};
  } catch (error) {
    console.error("Error fetching bundle sizes:", error);
    return {};
  }
};

// Lưu cache kích thước để tối ưu hiệu suất
const fileSizeCache: Record<string, number> = {};

/**
 * Lấy kích thước bundle từ server hoặc từ cache
 * Trả về 0 nếu không thể lấy được kích thước
 */
export const getFileSizes = async (
  bundleIds: string[]
): Promise<Record<string, number>> => {
  const fileSizes: Record<string, number> = {};

  // Lọc ra những ID chưa có trong cache
  const uncachedIds = bundleIds.filter((id) => !fileSizeCache[id]);

  // Nếu có ID chưa được cache, gọi API để lấy kích thước
  if (uncachedIds.length > 0) {
    try {
      const newSizes = await fetchFileSizesFromR2(uncachedIds);

      // Lưu các kích thước mới vào cache
      Object.entries(newSizes).forEach(([id, size]) => {
        fileSizeCache[id] = size || 0;
      });
    } catch (error) {
      console.error("Failed to fetch bundle sizes:", error);
    }
  }

  // Trả về kích thước từ cache cho tất cả bundle IDs
  bundleIds.forEach((id) => {
    fileSizes[id] = fileSizeCache[id] || 0;
  });

  return fileSizes;
};

// Thêm hàm xóa nhiều bundles cùng lúc từ R2
export const bulkDeleteFromR2 = async (
  keys: string[]
): Promise<{
  success: boolean;
  partialSuccess?: boolean;
  message?: string;
  totalObjects?: number;
  deletedObjects?: number;
  results?: Array<{ key: string; success: boolean; error?: string }>;
  error?: string;
}> => {
  try {
    if (!keys || keys.length === 0) {
      return { success: false, error: "Danh sách keys trống" };
    }

    // Gọi API xóa objects
    const response = await fetch(`/rpc/r2/objects`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(keys),
    });

    if (!response.ok) {
      console.error("Error calling bulk delete API:", response.statusText);
      return {
        success: false,
        error: `Lỗi khi gọi API: ${response.statusText}`,
      };
    }

    return await response.json();
  } catch (error) {
    console.error("Error calling bulk delete API:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// Xóa bundle trực tiếp từ D1 và R2
export const deleteD1Bundle = async (
  bundleId: string
): Promise<DeleteBundleResponse> => {
  try {
    // Gọi API xóa bundle từ D1
    const d1Response = await fetch(`/rpc/bundles/${bundleId}/delete-d1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Nhận kết quả từ D1
    const d1Result = await d1Response.json();

    // Gọi API xóa đối tượng từ R2
    const r2Response = await fetch(`/rpc/r2/delete/${bundleId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const r2Result = await r2Response.json();
    console.log("Kết quả xóa R2:", r2Result);

    // Trả về kết quả tổng hợp
    return {
      success: d1Result.success && r2Result.success,
      message: `Bundle đã được xóa từ D1${r2Result.success ? " và R2" : ""}`,
      d1Result,
      r2Result,
    };
  } catch (error) {
    console.error("Error calling delete APIs:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// Xóa nhiều bundles cùng lúc
export const bulkDeleteBundles = async (
  bundleIds: string[]
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  d1Result?: any;
  r2Result?: any;
  details?: any[];
}> => {
  try {
    if (!bundleIds || bundleIds.length === 0) {
      return { success: false, error: "Không có bundle nào được chọn để xóa" };
    }

    // Mảng để lưu kết quả từng bundle
    const results = [];
    const overallResult = {
      success: true,
      d1Success: 0,
      r2Success: 0,
      total: bundleIds.length,
    };

    // Xử lý từng bundle riêng lẻ
    for (const bundleId of bundleIds) {
      const result = await deleteD1Bundle(bundleId);
      results.push({
        bundleId,
        success: result.success,
        d1Success: result.d1Result?.success,
        r2Success: result.r2Result?.success || result.r2Result?.partialSuccess,
      });

      if (result.d1Result?.success) overallResult.d1Success++;
      if (result.r2Result?.success || result.r2Result?.partialSuccess)
        overallResult.r2Success++;
      if (!result.success) overallResult.success = false;
    }

    // Thông báo kết quả tổng hợp
    const messageD1 = `Đã xóa ${overallResult.d1Success}/${bundleIds.length} bundles từ D1`;
    const messageR2 = `Đã xóa ${overallResult.r2Success}/${bundleIds.length} bundles từ R2`;
    const message = `${messageD1}, ${messageR2}`;

    return {
      success: overallResult.success || overallResult.d1Success > 0,
      message,
      details: results,
    };
  } catch (error) {
    console.error("Error calling bulk delete API:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
