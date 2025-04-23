import { Checkbox } from "@/components/ui/checkbox";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIcon,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFilter } from "@/hooks/useFilter";
import {
  bulkDeleteBundles,
  bulkDeleteFromR2,
  createBundlesQuery,
  createChannelsQuery,
  getFileSizes,
} from "@/lib/api";
import type { Bundle } from "@hot-updater/core";
import {
  type ColumnDef,
  type PaginationState,
  type Row,
  type SortingState,
  createSolidTable,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
} from "@tanstack/solid-table";
import { Loader2, Trash2 } from "lucide-solid";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  splitProps,
} from "solid-js";
import { toast } from "solid-sonner";

const mbSize = 1000;
// Hàm định dạng kích thước file
const formatFileSize = (sizeInBytes: number | undefined | null): string => {
  if (sizeInBytes === undefined || sizeInBytes === null) return "0 MB";

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

interface DataTableProps {
  columns: ColumnDef<Bundle>[];
  onRowClick?: (row: Bundle) => void;
}

const DEFAULT_PAGE_SIZE = 20;

const [pagination, setPagination] = createSignal<PaginationState>({
  pageIndex: 0,
  pageSize: DEFAULT_PAGE_SIZE,
});

export function DataTable(props: DataTableProps) {
  const [local] = splitProps(props, ["columns", "onRowClick"]);
  const { channelFilter, platformFilter, setPlatformFilter, setChannelFilter } =
    useFilter();

  const [sorting, setSorting] = createSignal<SortingState>([
    { id: "id", desc: true }, // Mặc định sắp xếp theo thời gian tạo, mới nhất lên đầu
  ]);

  const query = createMemo(() => ({
    channel: channelFilter() ?? undefined,
    platform: platformFilter() ?? undefined,
    limit: pagination().pageSize.toString(),
    offset: (pagination().pageIndex * pagination().pageSize).toString(),
  }));

  const [bundles] = createBundlesQuery(query);

  const bundlesData = createMemo(() => bundles.data ?? []);

  // Thêm hằng số cho quota dung lượng tối đa (10GB)
  const MAX_STORAGE_QUOTA = 10 * 1000 * 1000 * 1000; // 10GB in bytes

  // Cập nhật hàm tính toán tổng dung lượng
  const totalBundleSize = createMemo(async () => {
    const bundles = bundlesData();
    if (!bundles.length) return 0;

    // Lấy tất cả ID của bundles
    const bundleIds = bundles.map((bundle) => bundle.id);

    // Lấy kích thước cho tất cả các bundle
    try {
      const fileSizes = await getFileSizes(bundleIds);

      // Tính tổng kích thước
      return Object.values(fileSizes).reduce((total, size) => total + size, 0);
    } catch (error) {
      console.error("Failed to get bundle sizes:", error);
      return 0;
    }
  });

  // Giá trị hiển thị cho tổng kích thước
  const [displayTotalSize, setDisplayTotalSize] = createSignal("0 MB / 10 GB");
  const [usagePercentage, setUsagePercentage] = createSignal(0);

  // Cập nhật giá trị hiển thị khi totalBundleSize thay đổi
  createEffect(async () => {
    const totalSize = await totalBundleSize();

    // Tính phần trăm sử dụng
    const percentage = Math.min(100, (totalSize / MAX_STORAGE_QUOTA) * 100);
    setUsagePercentage(percentage);

    // Định dạng chuỗi hiển thị
    const formattedSize = formatFileSize(totalSize);
    setDisplayTotalSize(`${formattedSize} / 10 GB`);
  });

  // Thêm state cho việc chọn nhiều
  const [selectedRows, setSelectedRows] = createSignal<string[]>([]);
  const [isDeleting, setIsDeleting] = createSignal(false);

  // Tạo hàm để toggle chọn một hàng
  const toggleRowSelection = (rowId: string) => {
    const selected = selectedRows();
    if (selected.includes(rowId)) {
      setSelectedRows(selected.filter((id) => id !== rowId));
    } else {
      setSelectedRows([...selected, rowId]);
    }
  };

  // Chọn tất cả các hàng
  const toggleSelectAll = () => {
    if (selectedRows().length === bundlesData().length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(bundlesData().map((row) => row.id));
    }
  };

  // Xóa hàng loạt
  const handleBulkDelete = async () => {
    const selected = selectedRows();
    if (selected.length === 0) {
      toast.error("Không có bundle nào được chọn để xóa");
      return;
    }

    if (
      !confirm(`Bạn có chắc chắn muốn xóa ${selected.length} bundles đã chọn?`)
    ) {
      return;
    }

    try {
      setIsDeleting(true);

      // Xóa từng bundle trong database
      const r1Result = await bulkDeleteBundles(selected);

      // Xóa các bundles trong R2 storage
      const bundleKeys = selected.map((id) => `${id}/bundle.zip`);
      const r2Result = await bulkDeleteFromR2(bundleKeys);

      if (r1Result.success || r2Result.success) {
        toast.success(`Đã xóa ${selected.length} bundles thành công`);
        setSelectedRows([]);
        // Làm mới trang sau khi xóa
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        toast.error(
          r1Result.error ||
            r2Result.error ||
            "Có lỗi xảy ra khi xóa các bundles"
        );
      }
    } catch (error) {
      console.error("Lỗi khi xóa hàng loạt:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Có lỗi xảy ra khi xóa hàng loạt"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const table = createSolidTable({
    get data() {
      return bundlesData();
    },
    columns: [
      // Thêm cột checkbox ở đầu
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={
              selectedRows().length === bundlesData().length &&
              bundlesData().length > 0
            }
            onClick={toggleSelectAll}
            aria-label="Chọn tất cả"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedRows().includes(row.original.id)}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              toggleRowSelection(row.original.id);
            }}
            aria-label="Chọn hàng"
          />
        ),
        size: 30,
      },
      ...local.columns,
    ],
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      get pagination() {
        return pagination();
      },
      get globalFilter() {
        return platformFilter();
      },
      get sorting() {
        return sorting();
      },
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    globalFilterFn: (row, _, filterValue) => {
      if (!filterValue) return true;
      return (row.original as Bundle).platform.toLowerCase() === filterValue;
    },
    manualPagination: false,
  });

  const handleRowClick = (row: Row<Bundle>) => () => {
    local.onRowClick?.(row.original);
  };

  const channels = createChannelsQuery();

  createEffect(() => {
    if (channels.isFetched && channels.data && channelFilter() === null) {
      setChannelFilter(channels.data[0]);
    }
  });

  return (
    <div
      class="transition-opacity duration-300"
      classList={{
        "opacity-50": bundles.isFetching,
      }}
    >
      <div class="flex flex-row justify-end p-3">
        <div class="flex items-center gap-4">
          <div class="text-sm text-muted-foreground">Platform:</div>
          <NavigationMenu>
            <NavigationMenuItem>
              <NavigationMenuTrigger class="w-[100px]">
                {platformFilter() ? platformFilter() : "All"}
                <NavigationMenuIcon />
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <For
                  each={
                    [
                      { label: "All", value: null },
                      { label: "iOS", value: "ios" },
                      { label: "Android", value: "android" },
                    ] as const
                  }
                >
                  {(platform) => (
                    <NavigationMenuLink
                      classList={{
                        "bg-primary text-primary-foreground":
                          platform.value === platformFilter(),
                      }}
                      onClick={() => setPlatformFilter(platform.value)}
                    >
                      {platform.label}
                    </NavigationMenuLink>
                  )}
                </For>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenu>

          <div class="text-sm text-muted-foreground">Channel:</div>
          <NavigationMenu>
            <NavigationMenuItem>
              <NavigationMenuTrigger class="w-[100px]">
                {channelFilter()}
                <NavigationMenuIcon />
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <For each={channels.data}>
                  {(channel) => (
                    <NavigationMenuLink
                      classList={{
                        "bg-primary text-primary-foreground":
                          channel === channelFilter(),
                      }}
                      onClick={() => setChannelFilter(channel)}
                    >
                      {channel}
                    </NavigationMenuLink>
                  )}
                </For>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenu>
        </div>
      </div>

      <div
        class="border rounded-md"
        classList={{
          "min-h-[400px]": bundles.isFetching,
        }}
      >
        <Table>
          <TableHeader>
            <For each={table.getHeaderGroups()}>
              {(headerGroup) => (
                <TableRow>
                  <For each={headerGroup.headers}>
                    {(header) => (
                      <TableHead class="text-xs font-semibold">
                        {header.isPlaceholder ? null : (
                          <div
                            class="select-none"
                            onClick={() => {
                              if (header.column.getCanSort()) {
                                header.column.toggleSorting();
                              }
                            }}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                          </div>
                        )}
                      </TableHead>
                    )}
                  </For>
                </TableRow>
              )}
            </For>
          </TableHeader>
          <TableBody>
            <Show
              when={bundlesData().length > 0}
              fallback={
                <TableRow>
                  <TableCell
                    colSpan={table.getAllColumns().length}
                    class="h-[400px] text-center"
                    classList={{
                      "text-muted-foreground": !bundles.isFetching,
                    }}
                  >
                    {bundles.isFetching ? (
                      <div class="flex flex-col items-center gap-2">
                        <Loader2 class="h-6 w-6 animate-spin" />
                        <span>Đang tải...</span>
                      </div>
                    ) : (
                      "Không tìm thấy bundle nào"
                    )}
                  </TableCell>
                </TableRow>
              }
            >
              <For each={table.getRowModel().rows}>
                {(row) => (
                  <TableRow
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    onClick={handleRowClick(row)}
                    class="cursor-pointer"
                  >
                    <For each={row.getVisibleCells()}>
                      {(cell) => (
                        <TableCell>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      )}
                    </For>
                  </TableRow>
                )}
              </For>
            </Show>
          </TableBody>
        </Table>
      </div>

      <div class="flex flex-col md:flex-row items-center justify-between gap-4 p-3">
        <div class="text-xs text-muted-foreground md:flex gap-6">
          <div class="flex items-center gap-1">
            Tổng số:
            <span class="font-bold text-red-600">{bundlesData().length}</span>
            bundle
          </div>
          <div class="relative">
            Tổng dung lượng:{" "}
            <span class="font-medium">{displayTotalSize()}</span>
            <div class="w-full h-1 bg-gray-200 mt-1 rounded-full">
              <div
                class="h-1 rounded-full"
                classList={{
                  "bg-green-500": usagePercentage() < 70,
                  "bg-yellow-500":
                    usagePercentage() >= 70 && usagePercentage() < 90,
                  "bg-red-500": usagePercentage() >= 90,
                }}
                style={{ width: `${usagePercentage()}%` }}
              />
            </div>
          </div>
        </div>
        <div class="self-end">
          <div class="flex items-center gap-1">
            <button
              class="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent"
              onClick={() => {
                const currentPage = pagination().pageIndex;
                if (currentPage > 0) {
                  setPagination((p) => ({ ...p, pageIndex: currentPage - 1 }));
                }
              }}
              disabled={pagination().pageIndex === 0}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4 w-4"
              >
                <path d="M15 6l-6 6l6 6" />
              </svg>
            </button>
            <span class="text-xs px-3">
              {pagination().pageIndex + 1} / {table.getPageCount() || 1}
            </span>
            <button
              class="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent"
              onClick={() => {
                const currentPage = pagination().pageIndex;
                const pageCount = table.getPageCount();
                if (currentPage < pageCount - 1) {
                  setPagination((p) => ({ ...p, pageIndex: currentPage + 1 }));
                }
              }}
              disabled={
                pagination().pageIndex >= (table.getPageCount() - 1 || 0)
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4 w-4"
              >
                <path d="M9 6l6 6l-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Hiển thị thanh công cụ khi có hàng được chọn */}
      <Show when={selectedRows().length > 0}>
        <div class="bg-blue-50 p-2 rounded-md flex items-center justify-between">
          <span class="text-sm text-blue-700">
            Đã chọn {selectedRows().length} bundle
          </span>
          <button
            class="bg-red-50 text-red-600 hover:bg-red-100 rounded-md px-3 py-1 text-sm flex items-center gap-1 transition-colors disabled:opacity-50"
            onClick={handleBulkDelete}
            disabled={isDeleting()}
          >
            <Show
              when={!isDeleting()}
              fallback={<Loader2 class="w-3 h-3 animate-spin" />}
            >
              <Trash2 class="w-3 h-3" />
            </Show>
            Xóa {selectedRows().length} bundle
          </button>
        </div>
      </Show>
    </div>
  );
}
