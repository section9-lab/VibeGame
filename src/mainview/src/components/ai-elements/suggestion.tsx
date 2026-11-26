"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Suggestions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="suggestions"
      className={cn(
        "flex scroll-fade-x no-scrollbar gap-2 overflow-x-auto overscroll-x-contain",
        className
      )}
      {...props}
    />
  )
}

type SuggestionProps = Omit<React.ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string
  onClick?: (suggestion: string) => void
}

function Suggestion({
  suggestion,
  onClick,
  className,
  children,
  variant = "outline",
  size = "sm",
  ...props
}: SuggestionProps) {
  return (
    <Button
      data-slot="suggestion"
      type="button"
      variant={variant}
      size={size}
      className={cn("shrink-0", className)}
      onClick={() => onClick?.(suggestion)}
      {...props}
    >
      {children ?? suggestion}
    </Button>
  )
}

export { Suggestion, Suggestions, type SuggestionProps }
