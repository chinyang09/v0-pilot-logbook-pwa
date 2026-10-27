import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Every button is a CAPSULE — the app's one shape for a thing you press (see
 * `.control-surface` in globals.css). `outline` and `secondary` are the action
 * surface itself, the glass control's face and rim, so a button in a form or
 * an empty state is visibly the same kind of thing as a header control;
 * `default` is its PRIMARY fill and `destructive` its red one. The default
 * used to be a solid accent pill, so the app had two primaries — that one
 * (Save Signature, Check Legality, Install) and the action surface's (Restore,
 * Reload) — for the same job. `ghost` and `link` carry no surface, for a
 * control that has its own look (the login page's buttons over the photo).
 * Content (cards, rows, sections) keeps the rounded rectangle.
 *
 * `sm` is 36px, not 32: every control a thumb has to hit is at least `h-9`.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,scale] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'control-surface control-surface-primary',
        destructive:
          'control-surface control-surface-destructive focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline: 'control-surface',
        secondary: 'control-surface',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-9 gap-1.5 px-3.5 has-[>svg]:px-3',
        lg: 'h-11 px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-9',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
