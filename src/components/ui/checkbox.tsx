"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

const box =
  "M11.892 1.333H4.108c-.352 0-.655 0-.905.02-.263.022-.525.07-.778.198a2 2 0 0 0-.874.874 2 2 0 0 0-.197.778c-.02.25-.02.553-.02.905v7.784c0 .352 0 .655.02.905.021.263.069.525.197.778a2 2 0 0 0 .874.874c.253.128.515.176.778.197.25.02.553.02.905.02h7.784c.352 0 .655 0 .905-.02.263-.021.525-.069.778-.197a2 2 0 0 0 .874-.874c.128-.253.176-.515.197-.778.02-.25.02-.553.02-.905V4.108c0-.352 0-.655-.02-.905a2 2 0 0 0-.197-.778 2 2 0 0 0-.874-.874 2 2 0 0 0-.778-.197c-.25-.02-.553-.02-.905-.02"

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group peer inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-[#323232] outline-none select-none transition-[color] duration-150 ease-power3-out hover:text-line-strong focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="size-4 group-data-[state=checked]:hidden group-data-[state=indeterminate]:hidden"
      >
        <path
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.333"
          d="M2 5.2c0-1.12 0-1.68.218-2.108a2 2 0 0 1 .874-.874C3.52 2 4.08 2 5.2 2h5.6c1.12 0 1.68 0 2.108.218a2 2 0 0 1 .874.874C14 3.52 14 4.08 14 5.2v5.6c0 1.12 0 1.68-.218 2.108a2 2 0 0 1-.874.874C12.48 14 11.92 14 10.8 14H5.2c-1.12 0-1.68 0-2.108-.218a2 2 0 0 1-.874-.874C2 12.48 2 11.92 2 10.8z"
        />
      </svg>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="hidden size-4 group-data-[state=checked]:block">
        <path
          fill="#FFDB4B"
          fillRule="evenodd"
          clipRule="evenodd"
          d={`${box}m-.42 5.138a.667.667 0 1 0-.943-.942L7 9.057 5.471 7.53a.667.667 0 1 0-.942.942l2 2c.26.26.682.26.942 0z`}
        />
      </svg>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="hidden size-4 group-data-[state=indeterminate]:block"
      >
        <path
          fill="#FFDB4B"
          fillRule="evenodd"
          clipRule="evenodd"
          d={`${box}m-6.559 6a.667.667 0 0 0 0 1.334h5.334a.667.667 0 0 0 0-1.334z`}
        />
      </svg>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
