import path from "path";
import { createWrangler } from "./utils/createWrangler";

import mime from "mime";

import type {
  BasePluginArgs,
  StoragePlugin,
  StoragePluginHooks,
} from "@hot-updater/plugin-core";

import Cloudflare from "cloudflare";
import { ExecaError } from "execa";

export interface R2StorageConfig {
  cloudflareApiToken: string;
  accountId: string;
  bucketName: string;
}

export const r2Storage =
  (config: R2StorageConfig, hooks?: StoragePluginHooks) =>
  (_: BasePluginArgs): StoragePlugin => {
    const { bucketName, cloudflareApiToken, accountId } = config;
    const cf = new Cloudflare({
      apiToken: cloudflareApiToken,
    });
    const wrangler = createWrangler({
      accountId,
      cloudflareApiToken: cloudflareApiToken,
      cwd: process.cwd(),
    });

    return {
      name: "r2Storage",
      async deleteBundle(bundleId) {
        try {
          console.log(
            `Attempting to delete bundle with ID: ${bundleId} from bucket: ${bucketName}`
          );

          // Wrangler 4.x+ đã thay đổi cách xóa đối tượng R2
          // Cần xóa tất cả các đối tượng có prefix là bundleId/
          const command = [
            "r2",
            "object",
            "delete",
            `${bucketName}/${bundleId}`,
          ];

          console.log("Running wrangler command:", command.join(" "));
          await wrangler(...command, "--remote");
          console.log(`Successfully deleted bundle: ${bundleId}`);
          return bundleId;
        } catch (error) {
          console.error("Error deleting from R2:", error);
          // Một lỗi đặc biệt có thể xảy ra là "Bundle Not Found"
          // Chúng ta sẽ bỏ qua lỗi này vì nó có thể là lỗi giả từ module
          if (error instanceof Error && error.message === "Bundle Not Found") {
            console.log(
              "Bundle Not Found error occurred but we're ignoring it"
            );
            return bundleId;
          }

          // Vấn đề có thể là Wrangler CLI
          if (
            error instanceof Error &&
            (error.message.includes("wrangler: command not found") ||
              error.message.includes("Command failed with exit code 127"))
          ) {
            throw new Error(
              `Wrangler CLI không được tìm thấy. Vui lòng cài đặt bằng lệnh: npm install -g wrangler`
            );
          }

          throw new Error(
            `Failed to delete bundle ${bundleId} from R2: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },
      async uploadBundle(bundleId, bundlePath) {
        const contentType = mime.getType(bundlePath) ?? void 0;

        const filename = path.basename(bundlePath);

        const Key = [bundleId, filename].join("/");

        try {
          const { stderr } = await wrangler(
            "r2",
            "object",
            "put",
            [bucketName, Key].join("/"),
            "--file",
            bundlePath,
            ...(contentType ? ["--content-type", contentType] : []),
            "--remote"
          );
          if (stderr) {
            throw new Error(stderr);
          }
        } catch (error) {
          if (error instanceof ExecaError) {
            throw new Error(error.stderr || error.stdout);
          }

          throw error;
        }

        hooks?.onStorageUploaded?.();

        return {
          bucketName,
          key: Key,
        };
      },
    };
  };
