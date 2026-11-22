"use client"

/**
 * A text the pilot writes into a briefing — sector info, a frequency, an
 * airport's notes. It grows with what is typed (a CSS mirror in the same grid
 * cell, never a `scrollHeight` read), keeps its own draft while focused so a
 * sync landing underneath cannot overwrite a word being typed, and commits on
 * blur and after a pause.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

export function NoteText({
  value,
  onCommit,
  placeholder,
  label,
  className,
  single = false,
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  label: string
  className?: string
  /** One line — Enter does not break the line. */
  single?: boolean
}) {
  const [draft, setDraft] = React.useState(value)
  const [focused, setFocused] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = React.useRef(onCommit)
  React.useEffect(() => {
    commitRef.current = onCommit
  })
  // The record moved underneath (another device, an import) and the pilot is not typing here.
  const [seen, setSeen] = React.useState(value)
  if (value !== seen && !focused) {
    setSeen(value)
    setDraft(value)
  }
  const flush = React.useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (next !== value) commitRef.current(next)
  }, [value])
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const text = "block w-full leading-snug [grid-area:1/1] whitespace-pre-wrap break-words"
  return (
    <div className={cn("grid text-[14px]", className)}>
      <div aria-hidden className={cn(text, "invisible")}>
        {draft + " "}
      </div>
      <textarea
        aria-label={label}
        placeholder={placeholder}
        rows={1}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          flush(draft)
        }}
        onKeyDown={(e) => {
          if (single && e.key === "Enter") {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
        onChange={(e) => {
          const next = single ? e.target.value.replace(/\n/g, " ") : e.target.value
          setDraft(next)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => flush(next), 900)
        }}
        className={cn(text, "h-full min-w-0 resize-none overflow-hidden bg-transparent text-foreground outline-none placeholder:text-muted-foreground")}
      />
    </div>
  )
}
