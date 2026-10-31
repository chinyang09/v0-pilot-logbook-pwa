"use client"

/**
 * Settings › Appearance: the mode (light / dark / system), the palette, and the
 * editor for the pilot's own palette.
 *
 * Every preview here is drawn from the SAME generator the app paints with
 * (`generatePalette`), so a swatch cannot promise a colour the app will not
 * deliver. The custom editor previews LIVE on the whole app — the page you are
 * looking at is the preview — and commits to the stored preference once the
 * slider settles, so a drag does not re-render every consumer of the
 * preferences context sixty times a second.
 */

import { useMemo, useRef, useState, type ReactNode } from "react"
import { ReadingPanel } from "@/components/ui/detail-form-panel"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { useTheme } from "next-themes"
import { Check, Laptop, Moon, Sun, SlidersHorizontal } from "lucide-react"
import { FormSection } from "@/components/ui/form-section"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/components/providers/preferences-provider"
import {
  CUSTOM_PALETTE_ID,
  PALETTE_PRESETS,
  generatePalette,
  presetById,
  resolveSeed,
  type DarkDepth,
  type PaletteSeed,
  type ThemeMode,
} from "@/lib/theme/palette"
import { applyPalette } from "@/lib/theme/apply"
import type { ThemePreference } from "@/types/db/stores.types"

const MODES: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
]

const VIVIDNESS: Array<{ label: string; chroma: number }> = [
  { label: "Soft", chroma: 0.07 },
  { label: "Balanced", chroma: 0.12 },
  { label: "Vivid", chroma: 0.18 },
]

const VIVIDNESS_TABS = VIVIDNESS.map((v) => ({ value: v.label, label: v.label }))

const DEPTHS: Array<{ value: DarkDepth; label: string }> = [
  { value: "dim", label: "Dim" },
  { value: "deep", label: "Deep" },
  { value: "black", label: "Black" },
]

/** How long a slider has to rest before the value is written to the preference. */
const COMMIT_DELAY_MS = 400

export function AppearanceSettings() {
  const { preferences, updateDisplay } = usePreferences()
  // Highlight the mode ACTUALLY in force. The stored preference and
  // next-themes' own storage can disagree — when the preference row is
  // missing (signed out and back in, cleared site data) the preference fell
  // back to its "dark" default while the screen was light, and this showed
  // "Dark" selected over a light page.
  const { theme, setTheme, resolvedTheme } = useTheme()
  const activeMode = (theme as ThemePreference | undefined) ?? preferences.display.theme
  const previewMode: ThemeMode = resolvedTheme === "light" ? "light" : "dark"

  const { palette, customPalette } = preferences.display
  const isCustom = palette === CUSTOM_PALETTE_ID
  const currentSeed = resolveSeed(palette, customPalette)

  const chooseCustom = () => {
    // The first time, start the pilot's own palette from whatever they had on
    // screen, so "Custom" is a small step from here rather than a reset.
    updateDisplay({ palette: CUSTOM_PALETTE_ID, customPalette: customPalette ?? currentSeed })
  }

  return (
    <ReadingPanel title="Appearance" description="Mode and colours, for this device.">

      <FormSection title="Mode">
        <div className="grid grid-cols-3 gap-2 p-3">
          {MODES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeMode === value}
              onClick={() => {
                setTheme(value)
                updateDisplay({ theme: value })
              }}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 transition-colors",
                activeMode === value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </FormSection>

      <FormSection title="Palette">
        <div className="@container p-3">
          <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3">
            {PALETTE_PRESETS.map((preset) => (
              <PaletteCard
                key={preset.id}
                name={preset.name}
                description={preset.description}
                seed={preset.seed}
                mode={previewMode}
                selected={palette === preset.id}
                onSelect={() => updateDisplay({ palette: preset.id })}
              />
            ))}
            <PaletteCard
              name="Custom"
              description="Your own accent and tint"
              seed={customPalette ?? currentSeed}
              mode={previewMode}
              selected={isCustom}
              onSelect={chooseCustom}
              icon={SlidersHorizontal}
            />
          </div>
        </div>
      </FormSection>

      {isCustom && (
        <CustomPaletteEditor
          // Mounted fresh each time Custom is chosen, seeded from the stored
          // palette — its draft is local while a slider moves.
          key="custom-editor"
          initial={customPalette ?? currentSeed}
          onCommit={(seed) => updateDisplay({ palette: CUSTOM_PALETTE_ID, customPalette: seed })}
        />
      )}
    </ReadingPanel>
  )
}

function PaletteCard({
  name,
  description,
  seed,
  mode,
  selected,
  onSelect,
  icon: Icon,
}: {
  name: string
  description: string
  seed: PaletteSeed
  mode: ThemeMode
  selected: boolean
  onSelect: () => void
  icon?: typeof Sun
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-lg border-2 p-2 text-left transition-colors",
        selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
      )}
    >
      <PaletteSwatch seed={seed} mode={mode} />
      <div className="flex items-start gap-1.5 px-0.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm font-medium">
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{name}</span>
          </div>
          <div className="text-xs text-muted-foreground leading-snug">{description}</div>
        </div>
        {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />}
      </div>
    </button>
  )
}

/** A miniature of the app in this palette: the ground, a card on it, two lines of text and the accent. */
export function PaletteSwatch({ seed, mode }: { seed: PaletteSeed; mode: ThemeMode }) {
  const t = useMemo(() => generatePalette(seed, mode).tokens, [seed, mode])
  return (
    <div
      aria-hidden
      className="relative h-16 overflow-hidden rounded-md"
      style={{ background: t.background, boxShadow: `inset 0 0 0 1px ${t.border}` }}
    >
      <div
        className="absolute inset-x-2 inset-y-2 flex flex-col gap-1 rounded-[5px] p-1.5"
        style={{ background: t.card, boxShadow: `inset 0 0 0 1px ${t.border}` }}
      >
        <div className="h-1.5 w-3/5 rounded-full" style={{ background: t.foreground }} />
        <div className="h-1.5 w-2/5 rounded-full" style={{ background: t["muted-foreground"] }} />
        <div className="mt-auto flex items-center gap-1">
          <div className="h-2.5 w-7 rounded-full" style={{ background: t.primary }} />
          <div className="h-2.5 w-4 rounded-full" style={{ background: t.secondary }} />
        </div>
      </div>
    </div>
  )
}

/** A track running round the hue circle at a lightness and chroma that suits a swatch. */
function hueTrack(l: number, c: number): string {
  const stops = Array.from({ length: 13 }, (_, i) => `oklch(${l} ${c} ${i * 30})`)
  return `linear-gradient(to right, ${stops.join(", ")})`
}

function CustomPaletteEditor({ initial, onCommit }: { initial: PaletteSeed; onCommit: (seed: PaletteSeed) => void }) {
  const [draft, setDraft] = useState<PaletteSeed>(initial)
  const frameRef = useRef<number | null>(null)
  const commitRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const change = (patch: Partial<PaletteSeed>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    // The live preview: straight onto the page, once a frame.
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      applyPalette(next)
    })
    // The preference: once the control has settled.
    if (commitRef.current) clearTimeout(commitRef.current)
    commitRef.current = setTimeout(() => onCommit(next), COMMIT_DELAY_MS)
  }

  const groundSwatch = `oklch(0.6 ${0.02 + draft.groundTint * 0.08} ${draft.groundHue})`
  const accentSwatch = `oklch(0.68 ${draft.accentChroma} ${draft.accentHue})`
  const vividness = VIVIDNESS.reduce((best, v) =>
    Math.abs(v.chroma - draft.accentChroma) < Math.abs(best.chroma - draft.accentChroma) ? v : best
  )

  return (
    <FormSection title="Custom Palette">
      <div className="divide-y divide-border">
        <EditorRow label="Accent" swatch={accentSwatch}>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={Math.round(draft.accentHue)}
            onChange={(e) => change({ accentHue: Number(e.target.value) })}
            aria-label="Accent hue"
            className="palette-range"
            style={{ backgroundImage: hueTrack(0.68, 0.14) }}
          />
          <div className="mt-2">
            <SegmentedTabs
              tabs={VIVIDNESS_TABS}
              value={vividness.label}
              onChange={(label) => change({ accentChroma: VIVIDNESS.find((v) => v.label === label)!.chroma })}
            />
          </div>
        </EditorRow>

        <EditorRow label="Background Tint" swatch={groundSwatch}>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={Math.round(draft.groundHue)}
            onChange={(e) => change({ groundHue: Number(e.target.value) })}
            aria-label="Background tint hue"
            className="palette-range"
            style={{ backgroundImage: hueTrack(0.6, 0.06) }}
          />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(draft.groundTint * 100)}
            onChange={(e) => change({ groundTint: Number(e.target.value) / 100 })}
            aria-label="Background tint strength"
            aria-valuetext={`${Math.round(draft.groundTint * 100)}%`}
            className="palette-range mt-1"
            style={{
              backgroundImage: `linear-gradient(to right, oklch(0.6 0 0), oklch(0.6 0.1 ${draft.groundHue}))`,
            }}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Neutral</span>
            <span>Tinted</span>
          </div>
        </EditorRow>

        <EditorRow label="Dark Ground">
          <SegmentedTabs tabs={DEPTHS} value={draft.depth} onChange={(depth) => change({ depth })} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Black is darkest — best at night.
          </p>
        </EditorRow>

        <EditorRow label="Start From">
          <div className="flex flex-wrap gap-1.5">
            {PALETTE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => change(presetById(preset.id)!.seed)}
                className="control-surface h-9 rounded-full px-3.5 text-xs font-medium"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </EditorRow>

        <p className="px-4 py-3 text-xs text-muted-foreground">
          Text and accent stay readable whatever you choose.
        </p>
      </div>
    </FormSection>
  )
}

function EditorRow({ label, swatch, children }: { label: string; swatch?: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        {swatch && <span aria-hidden className="h-3.5 w-3.5 rounded-full" style={{ background: swatch }} />}
        <span className="text-sm font-medium">{label}</span>
      </div>
      {children}
    </div>
  )
}
