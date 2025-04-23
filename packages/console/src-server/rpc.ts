import { typiaValidator } from "@hono/typia-validator";
import {
  type Bundle,
  type ConfigResponse,
  type DatabasePlugin,
  getCwd,
  loadConfig,
} from "@hot-updater/plugin-core";
import { Hono } from "hono";
import fetch from "node-fetch";
import typia from "typia";

const queryBundlesSchema = typia.createValidate<{
  channel?: string;
  platform?: "ios" | "android";
  limit?: string;
  offset?: string;
}>();

const paramBundleIdSchema = typia.createValidate<{
  bundleId: string;
}>();

const updateBundleSchema = typia.createValidate<Partial<Bundle>>();

// Thêm schema mới cho yêu cầu danh sách bundleIds - tạm bỏ validation ở phần code xử lý
// const bodyBundleIdsSchema = createSchema({
//   bundleIds: Type.Array(Type.String()),
// });

// Khởi tạo config promise - chỉ tải một lần
let configPromise: Promise<{
  config: ConfigResponse;
  databasePlugin: DatabasePlugin;
}> | null = null;

// Hàm chuẩn bị config
const prepareConfig = async () => {
  if (!configPromise) {
    configPromise = (async () => {
      try {
        const config = await loadConfig(null);
        const databasePlugin =
          (await config?.database({ cwd: getCwd() })) ?? null;
        if (!databasePlugin) {
          throw new Error("Database plugin initialization failed");
        }
        return { config, databasePlugin };
      } catch (error) {
        console.error("Error during configuration initialization:", error);
        throw error;
      }
    })();
  }
  return configPromise;
};

export const rpc = new Hono()
  .get("/config", async (c) => {
    try {
      const { config } = await prepareConfig();
      return c.json({ console: config.console });
    } catch (error) {
      console.error("Error during config retrieval:", error);
      throw error;
    }
  })
  .get("/channels", async (c) => {
    try {
      const { databasePlugin } = await prepareConfig();
      const channels = await databasePlugin.getChannels();
      return c.json(channels ?? []);
    } catch (error) {
      console.error("Error during channel retrieval:", error);
      throw error;
    }
  })
  .get("/config-loaded", (c) => {
    try {
      const isLoaded = !!configPromise;
      return c.json({ configLoaded: isLoaded });
    } catch (error) {
      console.error("Error during config loaded retrieval:", error);
      throw error;
    }
  })
  .get("/bundles", typiaValidator("query", queryBundlesSchema), async (c) => {
    try {
      const query = c.req.valid("query");
      const { databasePlugin } = await prepareConfig();
      const bundles = await databasePlugin.getBundles({
        where: {
          channel: query.channel ?? undefined,
          platform: query.platform ?? undefined,
        },
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return c.json(bundles ?? []);
    } catch (error) {
      console.error("Error during bundle retrieval:", error);
      throw error;
    }
  })
  .get(
    "/bundles/:bundleId",
    typiaValidator("param", paramBundleIdSchema),
    async (c) => {
      try {
        const { bundleId } = c.req.valid("param");
        const { databasePlugin } = await prepareConfig();
        const bundle = await databasePlugin.getBundleById(bundleId);
        return c.json(bundle ?? null);
      } catch (error) {
        console.error("Error during bundle retrieval:", error);
        throw error;
      }
    }
  )
  .patch(
    "/bundles/:bundleId",
    typiaValidator("json", updateBundleSchema),
    async (c) => {
      try {
        const bundleId = c.req.param("bundleId");

        const partialBundle = c.req.valid("json");
        if (!bundleId) {
          return c.json({ error: "Target bundle ID is required" }, 400);
        }

        const { databasePlugin } = await prepareConfig();
        await databasePlugin.updateBundle(bundleId, partialBundle);
        await databasePlugin.commitBundle();
        return c.json({ success: true });
      } catch (error) {
        console.error("Error during bundle update:", error);
        if (error && typeof error === "object" && "message" in error) {
          return c.json({ error: error.message }, 500);
        }
        return c.json({ error: "Unknown error" }, 500);
      }
    }
  )
  .delete(
    "/bundles/:bundleId",
    typiaValidator("param", paramBundleIdSchema),
    async (c) => {
      try {
        const { bundleId } = c.req.valid("param");

        const { config, databasePlugin } = await prepareConfig();

        let storageError = null;

        // Nếu storage plugin tồn tại, thử xóa file từ storage (R2)
        if (config.storage) {
          try {
            const storagePlugin = await config.storage({ cwd: getCwd() });
            await storagePlugin.deleteBundle(bundleId);
          } catch (error) {
            console.warn("Error deleting bundle from storage:", error);

            // Bỏ qua hoàn toàn lỗi "Bundle Not Found" vì nó chỉ là lỗi giả từ module
            if (
              error instanceof Error &&
              error.message === "Bundle Not Found"
            ) {
              console.log("Bỏ qua lỗi 'Bundle Not Found' từ R2Storage");
              // Không lưu lỗi, coi như đã xóa thành công
            } else {
              // Lưu lại các lỗi khác để trả về cho client
              storageError =
                error instanceof Error ? error.message : String(error);
            }
          }
        }

        // Xóa hoàn toàn bundle trong database thay vì chỉ vô hiệu hóa
        try {
          // Không thể xóa hoàn toàn vì DatabasePlugin không hỗ trợ, chỉ có thể vô hiệu hóa
          await databasePlugin.updateBundle(bundleId, { enabled: false });
          await databasePlugin.commitBundle();
        } catch (dbError) {
          console.error("Error updating database:", dbError);
          return c.json(
            {
              success: false,
              error:
                dbError instanceof Error ? dbError.message : String(dbError),
            },
            500
          );
        }

        if (storageError) {
          // Trả về thành công một phần với thông báo lỗi
          return c.json({
            success: true,
            partialSuccess: true,
            storageError,
            message:
              "Bundle đã bị xóa khỏi database nhưng không thể xóa file từ storage",
          });
        }

        return c.json({
          success: true,
          message: "Bundle đã được xóa thành công",
        });
      } catch (error) {
        console.error("Error during bundle deletion:", error);
        if (error && typeof error === "object" && "message" in error) {
          return c.json({ error: error.message }, 500);
        }
        return c.json({ error: "Unknown error" }, 500);
      }
    }
  )
  .post(
    "/bundles/:bundleId/disable",
    typiaValidator("param", paramBundleIdSchema),
    async (c) => {
      try {
        const { bundleId } = c.req.valid("param");

        const { databasePlugin } = await prepareConfig();

        // Chỉ vô hiệu hóa bundle trong database, không gọi storagePlugin
        await databasePlugin.updateBundle(bundleId, { enabled: false });
        await databasePlugin.commitBundle();

        return c.json({
          success: true,
          message: "Bundle đã bị vô hiệu hóa thành công",
        });
      } catch (error) {
        console.error("Error during bundle disabling:", error);
        if (error && typeof error === "object" && "message" in error) {
          return c.json({ error: error.message }, 500);
        }
        return c.json({ error: "Unknown error" }, 500);
      }
    }
  )
  .post(
    "/r2/delete/:bundleId",
    typiaValidator("param", paramBundleIdSchema),
    async (c) => {
      try {
        const { bundleId } = c.req.valid("param");

        // Lấy thông tin cấu hình từ .env
        const cloudflareApiToken = process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN;
        const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID;
        const bucketName = process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME;

        if (!cloudflareApiToken || !accountId || !bucketName) {
          return c.json(
            {
              success: false,
              error: "Thiếu thông tin cấu hình Cloudflare R2",
            },
            400
          );
        }

        console.log(`Đang xóa bundle ${bundleId} từ R2 storage...`);

        // Tạo key từ bundleId để xóa trực tiếp
        const objectKey = `${bundleId}/bundle.zip`;

        // Xóa object bằng API Cloudflare thông thường
        const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(
          objectKey
        )}`;

        const deleteResponse = await fetch(apiUrl, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${cloudflareApiToken}`,
            "Content-Type": "application/json",
          },
        });

        if (!deleteResponse.ok) {
          let errorMessage = `Lỗi khi xóa từ R2: ${deleteResponse.status} ${deleteResponse.statusText}`;
          try {
            const errorData = await deleteResponse.json();
            console.error("Lỗi xóa R2:", JSON.stringify(errorData));
            errorMessage = `Lỗi R2: ${JSON.stringify(errorData)}`;
          } catch (e) {
            // Không làm gì khi không parse được response
          }

          return c.json({
            success: false,
            error: errorMessage,
          });
        }

        return c.json({
          success: true,
          message: `Đã xóa bundle ${bundleId} thành công từ R2 storage`,
        });
      } catch (error) {
        console.error("Lỗi khi xóa từ R2:", error);
        return c.json(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500
        );
      }
    }
  )
  .post(
    "/bundles/:bundleId/complete-delete",
    typiaValidator("param", paramBundleIdSchema),
    async (c) => {
      try {
        const { bundleId } = c.req.valid("param");

        // 1. Vô hiệu hóa bundle trong D1 database
        const { databasePlugin } = await prepareConfig();
        await databasePlugin.updateBundle(bundleId, { enabled: false });
        await databasePlugin.commitBundle();

        // 2. Xóa file trong R2
        // Lấy thông tin cấu hình
        const apiToken = process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN;
        const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID;
        const bucketName = process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME;

        if (!apiToken || !accountId || !bucketName) {
          return c.json({
            success: true,
            message:
              "Bundle đã bị vô hiệu hóa trong database, nhưng không thể xóa từ R2 do thiếu cấu hình",
          });
        }

        // Tìm các file của bundle trong R2
        const listUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects?prefix=${bundleId}`;
        const listResponse = await fetch(listUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
        });

        if (!listResponse.ok) {
          return c.json({
            success: true,
            message: `Bundle đã bị vô hiệu hóa trong database, nhưng không thể liệt kê file trong R2: ${listResponse.statusText}`,
          });
        }

        interface R2Response {
          result?: {
            objects?: Array<{ key: string; size: number }>;
          };
        }

        const data = (await listResponse.json()) as R2Response;
        const objects = data.result?.objects || [];

        if (objects.length === 0) {
          return c.json({
            success: true,
            message:
              "Bundle đã bị vô hiệu hóa trong database, không có file R2 cần xóa",
          });
        }

        // Xóa tất cả các file
        const objectKeys = objects.map((obj: { key: string }) => obj.key);
        const deleteUrl = `/rpc/r2/objects`;
        const deleteResponse = await fetch(deleteUrl, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ keys: objectKeys }),
        });

        interface DeleteResult {
          success: boolean;
          deletedObjects: number;
          totalObjects: number;
        }

        const deleteResult = (await deleteResponse.json()) as DeleteResult;

        return c.json({
          success: true,
          message: `Bundle đã bị vô hiệu hóa trong database, ${deleteResult.deletedObjects}/${deleteResult.totalObjects} file đã bị xóa từ R2`,
          r2Result: deleteResult,
        });
      } catch (error) {
        console.error("Lỗi khi xóa bundle:", error);
        return c.json(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500
        );
      }
    }
  )
  .get("/r2/objects", async (c) => {
    try {
      // Lấy thông tin cấu hình từ .env
      const cloudflareApiToken =
        process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN || "";
      const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID || "";
      const bucketName =
        process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME || "";

      if (!cloudflareApiToken || !accountId || !bucketName) {
        return c.json(
          {
            success: false,
            error: "Thiếu thông tin cấu hình Cloudflare",
          },
          400
        );
      }

      // Cấu trúc URL theo định dạng chính xác
      const baseURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}`;
      const url = `${baseURL}/objects?limit=1000`;

      console.log("Fetching R2 objects from Cloudflare");

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = (await response.json()) as {
          success: boolean;
          errors: Array<{ message: string }>;
        };
        console.error("Error fetching R2 objects:", errorData);
        return c.json(
          {
            success: false,
            error: `Failed to fetch R2 objects: ${response.statusText}`,
          },
          500
        );
      }

      interface R2Object {
        key: string;
        size: number;
        uploaded: string;
      }

      interface R2Response {
        result: {
          objects: R2Object[];
          truncated: boolean;
        };
        success: boolean;
      }

      const data = (await response.json()) as R2Response;

      return c.json({
        success: true,
        objects: data.result.objects,
      });
    } catch (error) {
      console.error("Error fetching R2 objects:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  })
  .delete("/r2/object", async (c) => {
    try {
      // Lấy key từ request
      const body = (await c.req.json()) as { key?: string };
      const key = body.key;

      if (!key) {
        return c.json(
          {
            success: false,
            error: "Key không được cung cấp",
          },
          400
        );
      }

      // Lấy thông tin cấu hình từ .env
      const cloudflareApiToken =
        process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN || "";
      const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID || "";
      const bucketName =
        process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME || "";

      if (!cloudflareApiToken || !accountId || !bucketName) {
        return c.json(
          {
            success: false,
            error: "Thiếu thông tin cấu hình Cloudflare",
          },
          400
        );
      }

      // Gọi API Cloudflare để xóa object
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${key}`;

      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        let errorMessage = `Failed to delete R2 object: ${response.statusText}`;

        try {
          const errorData = (await response.json()) as {
            success: boolean;
            errors: Array<{ message: string }>;
          };
          console.error("Error deleting R2 object:", errorData);
          if (errorData.errors && errorData.errors.length > 0) {
            errorMessage = errorData.errors.map((e) => e.message).join(", ");
          }
        } catch (e) {
          console.error("Could not parse error response:", e);
        }

        return c.json(
          {
            success: false,
            error: errorMessage,
          },
          500
        );
      }

      return c.json({
        success: true,
      });
    } catch (error) {
      console.error("Error deleting R2 object:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  })
  .delete("/r2/objects", async (c) => {
    try {
      // Lấy danh sách keys từ request
      const keys = (await c.req.json()) as string[];

      if (!keys || !Array.isArray(keys) || keys.length === 0) {
        return c.json(
          {
            success: false,
            error: "Danh sách keys không hợp lệ hoặc trống",
          },
          400
        );
      }

      // Lấy thông tin cấu hình R2
      const apiToken = process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN;
      const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID;
      const bucketName = process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME;

      if (!apiToken || !accountId || !bucketName) {
        return c.json(
          {
            success: false,
            error: "Thiếu cấu hình R2",
          },
          500
        );
      }

      console.log(`Đang xóa ${keys.length} tệp từ R2 storage...`);

      // Kết quả cho mỗi key
      const results = [];
      let successCount = 0;

      // Xóa từng object riêng lẻ bằng API
      for (const key of keys) {
        try {
          const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(
            key
          )}`;

          const response = await fetch(apiUrl, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            results.push({ key, success: true });
            successCount++;
          } else {
            let errorData;
            try {
              errorData = await response.json();
            } catch (e) {
              errorData = { error: response.statusText };
            }

            results.push({
              key,
              success: false,
              error: JSON.stringify(errorData),
            });
          }
        } catch (error) {
          results.push({
            key,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return c.json({
        success: successCount > 0,
        totalObjects: keys.length,
        deletedObjects: successCount,
        message: `Đã xóa ${successCount}/${keys.length} tệp từ R2 storage`,
        results,
      });
    } catch (error) {
      console.error("Lỗi khi xóa R2:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  })
  .post("/bundle-sizes", async (c) => {
    try {
      // Lấy danh sách bundleIds từ request
      const body = (await c.req.json()) as { bundleIds?: string[] };
      const bundleIds = body.bundleIds || [];

      if (!Array.isArray(bundleIds)) {
        return c.json(
          {
            success: false,
            error: "bundleIds phải là một mảng",
          },
          400
        );
      }

      // Lấy thông tin cấu hình từ .env
      const cloudflareApiToken =
        process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN || "";
      const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID || "";
      const bucketName =
        process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME || "";

      if (!cloudflareApiToken || !accountId || !bucketName) {
        return c.json(
          {
            success: false,
            error: "Thiếu thông tin cấu hình Cloudflare",
          },
          400
        );
      }

      // Gọi Cloudflare API để lấy danh sách đối tượng
      const baseURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}`;
      const url = `${baseURL}/objects?limit=1000`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return c.json(
          {
            success: false,
            error: `Failed to fetch R2 objects: ${response.statusText}`,
          },
          500
        );
      }

      const data = (await response.json()) as any;
      const objects = data.result || [];

      // Map kích thước cho từng bundleId
      const fileSizes: Record<string, number> = {};

      bundleIds.forEach((bundleId) => {
        // Tìm đối tượng tương ứng với bundleId
        const matchingObject = objects.find(
          (obj: any) => obj.key && obj.key.startsWith(`${bundleId}/`)
        );

        if (matchingObject && typeof matchingObject.size === "number") {
          fileSizes[bundleId] = matchingObject.size;
        } else {
          fileSizes[bundleId] = 0;
        }
      });

      return c.json({
        success: true,
        fileSizes,
      });
    } catch (error) {
      console.error("Error getting bundle sizes:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  })
  .post(
    "/bundles/:bundleId/delete-d1",
    typiaValidator("param", paramBundleIdSchema),
    async (c) => {
      try {
        const { bundleId } = c.req.valid("param");

        // Lấy thông tin cấu hình Cloudflare D1
        const cloudflareApiToken = process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN;
        const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID;
        const d1DatabaseId = process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID;

        if (!cloudflareApiToken || !accountId || !d1DatabaseId) {
          return c.json(
            {
              success: false,
              error: "Thiếu thông tin cấu hình Cloudflare D1",
            },
            400
          );
        }

        // Gọi trực tiếp API Cloudflare D1 để xóa bundle
        const d1Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1DatabaseId}/query`;
        const deleteQuery = {
          sql: 'DELETE FROM [bundles] WHERE "id" = ?;',
          params: [bundleId],
        };

        console.log(`Đang xóa bundle ${bundleId} từ D1 database...`);

        const d1Response = await fetch(d1Url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cloudflareApiToken}`,
          },
          body: JSON.stringify(deleteQuery),
        });

        if (!d1Response.ok) {
          const errorData = await d1Response.text();
          console.error("Lỗi khi xóa D1:", errorData);
          return c.json(
            {
              success: false,
              error: `Không thể xóa bundle từ D1: ${d1Response.statusText}`,
              details: errorData,
            },
            500
          );
        }

        const d1Result = await d1Response.json();
        console.log("Kết quả xóa D1:", d1Result);

        // Báo cáo thành công và trả về kết quả
        return c.json({
          success: true,
          message: "Bundle đã được xóa hoàn toàn khỏi D1 database",
          d1Result,
        });
      } catch (error) {
        console.error("Lỗi khi xóa bundle từ D1:", error);
        return c.json(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500
        );
      }
    }
  )
  .post("/bundles/bulk-delete", async (c) => {
    try {
      // Lấy danh sách bundleIds từ request
      const body = (await c.req.json()) as { bundleIds?: string[] };
      const bundleIds = body.bundleIds || [];

      if (!Array.isArray(bundleIds) || bundleIds.length === 0) {
        return c.json(
          {
            success: false,
            error: "Danh sách bundleIds không hợp lệ hoặc trống",
          },
          400
        );
      }

      // Lấy thông tin cấu hình Cloudflare D1
      const cloudflareApiToken = process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN;
      const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID;
      const d1DatabaseId = process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID;

      if (!cloudflareApiToken || !accountId || !d1DatabaseId) {
        return c.json(
          {
            success: false,
            error: "Thiếu thông tin cấu hình Cloudflare D1",
          },
          400
        );
      }

      console.log(`Đang xóa ${bundleIds.length} bundles từ D1 database...`);

      // Xóa tất cả bundles từ D1
      const placeholders = bundleIds.map((_, index) => `$${index}`).join(", ");
      const d1Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1DatabaseId}/query`;
      const deleteQuery = {
        sql: `DELETE FROM [bundles] WHERE "id" IN (${placeholders});`,
        params: bundleIds,
      };

      const d1Response = await fetch(d1Url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cloudflareApiToken}`,
        },
        body: JSON.stringify(deleteQuery),
      });

      if (!d1Response.ok) {
        const errorData = await d1Response.text();
        console.error("Lỗi khi xóa D1:", errorData);
        return c.json(
          {
            success: false,
            error: `Không thể xóa bundles từ D1: ${d1Response.statusText}`,
            details: errorData,
          },
          500
        );
      }

      const d1Result = await d1Response.json();

      // Xóa tất cả files từ R2
      // Lấy thông tin cấu hình R2
      const bucketName = process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME;
      let r2Result = null;

      if (cloudflareApiToken && accountId && bucketName) {
        // Lấy danh sách objects từ R2
        const baseURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}`;
        const listUrl = `${baseURL}/objects?limit=1000`;

        const r2ListResponse = await fetch(listUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${cloudflareApiToken}`,
            "Content-Type": "application/json",
          },
        });

        if (r2ListResponse.ok) {
          interface R2ListResponse {
            result?: {
              objects?: Array<{ key: string }>;
            };
          }

          const r2Data = (await r2ListResponse.json()) as R2ListResponse;
          const allObjects = r2Data.result?.objects || [];

          // Lọc các objects thuộc về các bundles cần xóa
          const objectsToDelete = [];
          for (const object of allObjects) {
            for (const bundleId of bundleIds) {
              if (object.key.startsWith(`${bundleId}/`)) {
                objectsToDelete.push(object.key);
                break;
              }
            }
          }

          if (objectsToDelete.length > 0) {
            // Xóa tất cả objects
            const deleteUrl = `/rpc/r2/objects`;
            const r2DeleteResponse = await fetch(deleteUrl, {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ keys: objectsToDelete }),
            });

            if (r2DeleteResponse.ok) {
              r2Result = await r2DeleteResponse.json();
            }
          }
        }
      }

      return c.json({
        success: true,
        message: `Đã xóa ${bundleIds.length} bundles từ D1 database`,
        d1Result,
        r2Result,
      });
    } catch (error) {
      console.error("Lỗi khi xóa nhiều bundles:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  });

export type RpcType = typeof rpc;
