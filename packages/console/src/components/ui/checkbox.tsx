import { splitProps, type JSX } from "solid-js";
import { twMerge } from "tailwind-merge";

interface CheckboxProps extends JSX.HTMLAttributes<HTMLDivElement> {
  checked?: boolean;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
}

export function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, [
    "class",
    "checked",
    "onClick",
    "disabled",
    "aria-label",
  ]);

  return (
    <div
      role="checkbox"
      aria-checked={local.checked}
      aria-label={local["aria-label"]}
      class={twMerge(
        "h-4 w-4 shrink-0 rounded-sm border border-primary flex items-center justify-center cursor-pointer transition-colors",
        local.checked ? "bg-primary" : "bg-transparent",
        local.disabled ? "opacity-50 cursor-not-allowed" : "",
        local.class
      )}
      onClick={local.disabled ? undefined : local.onClick}
      {...others}
    >
      {local.checked && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3 w-3 text-white"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}
