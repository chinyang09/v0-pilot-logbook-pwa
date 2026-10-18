import { cn } from '@/lib/utils'

/**
 * A loading placeholder. `bg-muted`, NOT shadcn's default `bg-accent`: this
 * theme's dark `--accent` is a mid ORANGE (oklch 0.60 0.10 55), so every
 * skeleton painted a brand-coloured slab — on the dashboard's first visit the
 * legal page's full-height placeholder flashed the whole panel orange before
 * the content arrived. A placeholder should read as "not here yet", which is a
 * neutral one step off the surface.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
