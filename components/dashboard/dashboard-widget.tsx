"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

interface DashboardWidgetProps extends React.HTMLAttributes<HTMLDivElement> {
  href?: string
  ariaLabel?: string
  asChild?: boolean
}

export function DashboardWidget({
  href,
  ariaLabel,
  className,
  children,
  ...props
}: DashboardWidgetProps) {
  const base = cn(
    "group relative flex h-full w-full flex-col rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4 shadow-sm backdrop-blur-sm",
    "transition-colors",
    href && "cursor-pointer hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  )

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={base}>
        {children}
      </Link>
    )
  }

  return (
    <div className={base} aria-label={ariaLabel} {...props}>
      {children}
    </div>
  )
}

export function WidgetLabel({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  )
}

export function WidgetValue({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "font-mono tabular-nums text-foreground leading-tight",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  )
}
