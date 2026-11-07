'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // 24×40 with a track you can see OFF as well as on: the off track was
        // `--input` at 80%, which on a dark card is ΔL ≈ 0.01 — only the knob
        // showed, a white dot floating at the row's end. It is a tint of the
        // foreground now (iOS's systemFill does the same), so it reads on any
        // palette and either mode. The ROW is the hit area (`ToggleRow`).
        'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-foreground/15 dark:data-[state=unchecked]:bg-foreground/25 focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={
          'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none ml-px block size-5 rounded-full shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-4px)] data-[state=unchecked]:translate-x-0'
        }
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
