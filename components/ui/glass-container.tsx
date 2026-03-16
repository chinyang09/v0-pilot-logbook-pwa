"use client"

import type React from "react"
import { cn } from "@/lib/utils"

interface GlassContainerProps {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  cornerRadius?: number
  style?: React.CSSProperties
}

export function GlassContainer({
  children,
  className,
  contentClassName,
  cornerRadius = 24,
  style,
}: GlassContainerProps) {
  return (
    <div
      className={cn("GlassContainer", className)}
      style={{
        "--corner-radius": `${cornerRadius}px`,
        ...style,
      } as React.CSSProperties}
    >
      <div className={cn("GlassContent", contentClassName)}>
        {children}
      </div>
      <div className="GlassMaterial">
        <div className="GlassEdgeReflection" />
        <div className="GlassEmbossReflection" />
        <div className="GlassRefraction" />
        <div className="GlassBlur" />
        <div className="BlendLayers" />
        <div className="BlendEdge" />
        <div className="Highlight" />
      </div>
    </div>
  )
}
