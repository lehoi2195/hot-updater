import { getFileSizes } from "@/lib/api";
import { extractTimestampFromUUIDv7 } from "@/lib/extract-timestamp-from-uuidv7";
import type { Bundle } from "@hot-updater/core";
import type { ColumnDef } from "@tanstack/solid-table";
import dayjs from "dayjs";
import { ArrowDown, ArrowUp, Check, Download, Loader2, X } from "lucide-solid";
import { createResource, createSignal, Show } from "solid-js";
import { toast } from "solid-sonner";

const [fileSizesData, { refetch: refetchFileSizes }] = createResource(
  async () => {
    return await getFileSizes(["dummy-id"]);
  }
);
const mbSize = 1000;
const formatFileSize = (sizeInBytes: number | undefined | null): string => {
  if (sizeInBytes === undefined || sizeInBytes === null || sizeInBytes === 0)
    return "0 MB";

  if (sizeInBytes < mbSize) {
    return `${sizeInBytes} B`;
  } else if (sizeInBytes < mbSize * mbSize) {
    return `${(sizeInBytes / mbSize).toFixed(2)} KB`;
  } else if (sizeInBytes < mbSize * mbSize * mbSize) {
    return `${(sizeInBytes / (mbSize * mbSize)).toFixed(2)} MB`;
  } else {
    return `${(sizeInBytes / (mbSize * mbSize * mbSize)).toFixed(2)} GB`;
  }
};

export const columns: ColumnDef<Bundle>[] = [
  {
    id: "index",
    header: "#",
    size: 50,
    cell: (info) => (
      <span class="text-sm font-medium text-slate-600">
        {info.row.index + 1}
      </span>
    ),
  },
  {
    accessorKey: "id",
    id: "createdAt",
    header: ({ column }) => {
      return (
        <button
          class="flex items-center gap-1 font-semibold text-gray-700"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <span>Created At</span>
          {column.getIsSorted() === "asc" ? (
            <ArrowUp class="w-3 h-3" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown class="w-3 h-3" />
          ) : null}
        </button>
      );
    },
    minSize: 140,
    size: 150,
    sortingFn: (rowA, rowB, columnId) => {
      const a = String(rowA.getValue(columnId));
      const b = String(rowB.getValue(columnId));
      const timeA = extractTimestampFromUUIDv7(a);
      const timeB = extractTimestampFromUUIDv7(b);
      return timeA < timeB ? -1 : timeA > timeB ? 1 : 0;
    },
    cell: (info) => {
      const id = String(info.getValue());
      const timestamp = extractTimestampFromUUIDv7(id);
      const date = new Date(timestamp);

      return (
        <span class="text-xs font-medium text-gray-700 whitespace-nowrap block">
          {dayjs(date).format("HH:mm:ss DD/MM/YYYY")}
        </span>
      );
    },
  },
  {
    accessorKey: "platform",
    header: ({ column }) => (
      <span class="font-semibold text-gray-700">Platform</span>
    ),
    size: 100,
    cell: (info) => {
      const platform = String(info.getValue());
      switch (platform) {
        case "ios":
          return (
            <span class="text-xs font-bold text-[#007AFF] bg-[#E3F2FD] px-2 py-0.5 rounded inline-block text-center min-w-[50px]">
              iOS
            </span>
          );
        case "android":
          return (
            <span class="text-xs font-bold text-[#3DDC84] bg-[#E8F5E9] px-2 py-0.5 rounded inline-block text-center min-w-[50px]">
              Android
            </span>
          );
        default:
          return <span class="text-xs">{platform}</span>;
      }
    },
  },
  {
    accessorKey: "targetAppVersion",
    header: ({ column }) => (
      <span class="font-semibold text-gray-700">Version</span>
    ),
    size: 90,
    cell: (info) => (
      <span class="text-xs font-bold bg-gray-100 px-2 py-0.5 rounded inline-block text-center">
        {String(info.getValue())}
      </span>
    ),
  },
  {
    accessorKey: "message",
    header: ({ column }) => (
      <span class="font-semibold text-gray-700">Commit Message</span>
    ),
    minSize: 180,
    maxSize: 450,
    cell: (info) => (
      <span
        class="text-[15px] text-gray-700 truncate block max-w-[350px]"
        title={String(info.getValue())}
      >
        {String(info.getValue())}
      </span>
    ),
  },
  {
    accessorKey: "id",
    header: ({ column }) => (
      <span class="font-semibold text-gray-700">Size</span>
    ),
    size: 90,
    minSize: 90,
    cell: (info) => {
      const id = String(info.getValue());
      const [isLoading, setIsLoading] = createSignal(false);
      const [fileSize, setFileSize] = createSignal<number | null>(null);

      // Lấy kích thước từ cache hoặc tải mới nếu cần
      const getBundleSize = async () => {
        if (fileSize() !== null) return fileSize();

        // Kiểm tra xem đã có trong resource chưa
        const currentSizes = fileSizesData();
        if (currentSizes && currentSizes[id]) {
          setFileSize(currentSizes[id]);
          return currentSizes[id];
        }

        // Nếu chưa có, tải kích thước mới
        setIsLoading(true);
        try {
          const sizes = await getFileSizes([id]);
          setFileSize(sizes[id] || 0);
          return sizes[id] || 0;
        } catch (error) {
          console.error("Error loading size for bundle:", error);
          setFileSize(0);
          return 0;
        } finally {
          setIsLoading(false);
        }
      };

      // Gọi hàm lấy kích thước ngay khi component được render
      getBundleSize();

      return (
        <span class="text-xs font-medium bg-gray-100 rounded-full inline-flex items-center justify-center px-2 py-1 min-w-[70px]">
          <Show
            when={!isLoading()}
            fallback={<Loader2 class="w-3 h-3 animate-spin mx-auto" />}
          >
            {formatFileSize(fileSize())}
          </Show>
        </span>
      );
    },
  },
  {
    accessorKey: "enabled",
    header: ({ column }) => (
      <span class="font-semibold text-gray-700">Enabled</span>
    ),
    size: 50,
    minSize: 50,
    maxSize: 50,
    cell: (info) =>
      info.getValue() ? (
        <div class="flex justify-center items-center w-[50px]">
          <span class="bg-green-100 text-green-600 p-1 rounded-full">
            <Check class="w-3.5 h-3.5" />
          </span>
        </div>
      ) : (
        <div class="flex justify-center items-center w-[50px]">
          <span class="bg-red-100 text-red-600 p-1 rounded-full">
            <X class="w-3.5 h-3.5" />
          </span>
        </div>
      ),
  },
  {
    accessorKey: "shouldForceUpdate",
    header: ({ column }) => (
      <span class="font-semibold text-gray-700">Force</span>
    ),
    size: 50,
    minSize: 50,
    maxSize: 50,
    cell: (info) =>
      info.getValue() ? (
        <div class="flex justify-center items-center w-[50px]">
          <span class="bg-green-100 text-green-600 p-1 rounded-full">
            <Check class="w-3.5 h-3.5" />
          </span>
        </div>
      ) : (
        <div class="flex justify-center items-center w-[50px]">
          <span class="bg-red-100 text-red-600 p-1 rounded-full">
            <X class="w-3.5 h-3.5" />
          </span>
        </div>
      ),
  },
  {
    accessorKey: "id",
    id: "bundleId",
    header: "Bundle ID",
    size: 180,
    cell: (info) => {
      const bundleId = String(info.getValue());

      // Hiển thị rút gọn: 8 ký tự đầu và 4 ký tự cuối
      const truncatedId =
        bundleId.length > 12
          ? `${bundleId.substring(0, 8)}...${bundleId.substring(
              bundleId.length - 4
            )}`
          : bundleId;

      const handleCopy = async (e: MouseEvent) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(bundleId);
          toast.success("Đã sao chép ID vào clipboard");
        } catch (error) {
          toast.error("Không thể sao chép ID");
          console.error("Copy error:", error);
        }
      };

      return (
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono text-slate-600" title={bundleId}>
            {truncatedId}
          </span>
          <button
            onClick={handleCopy}
            class="bg-blue-50 hover:bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-xs transition-colors duration-200"
            title="Copy Bundle ID"
          >
            Copy
          </button>
        </div>
      );
    },
  },
];
