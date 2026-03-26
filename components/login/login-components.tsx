"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { AlertCircle, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react"

/**
 * Login step types
 */
export type LoginStep =
  | "initial"
  | "passkey-login"
  | "recovery"
  | "register-callsign"
  | "register-setup"
  | "register-verify"
  | "success"
  | "nudge-add-passkey"

/**
 * Error alert component for login forms — glass-compatible
 */
export function LoginErrorAlert({ error }: { error: string }) {
  if (!error) return null

  return (
    <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/25 rounded-lg text-sm text-red-300">
      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>{error}</span>
    </div>
  )
}

/**
 * Back button for step navigation — white ghost for glass cards
 */
export function StepBackButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-fit -ml-2 mb-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-[1.03] transition-transform"
      onClick={onClick}
      disabled={disabled}
    >
      <ArrowLeft className="h-4 w-4 mr-1" />
      Back
    </Button>
  )
}

/**
 * Glass card wrapper for login steps
 */
export function StepCard({
  title,
  description,
  children,
  onBack,
  showBack = true,
  error,
}: {
  title: string
  description: string
  children: React.ReactNode
  onBack?: () => void
  showBack?: boolean
  error?: string
}) {
  return (
    <div className="rounded-2xl bg-black/30 backdrop-blur-xl border border-white/[0.12] shadow-2xl overflow-hidden">
      <div className="px-6 pt-6 pb-2">
        {showBack && onBack && <StepBackButton onClick={onBack} />}
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="text-sm text-white/60 mt-1">{description}</p>
      </div>
      <div className="px-6 pb-6 pt-4 space-y-4">
        <LoginErrorAlert error={error || ""} />
        {children}
      </div>
    </div>
  )
}

/**
 * Loading step — glass card
 */
export function LoadingStep({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl bg-black/30 backdrop-blur-xl border border-white/[0.12] shadow-2xl">
      <div className="py-12 text-center">
        <Loader2 className="h-12 w-12 animate-spin mx-auto text-white/80 mb-4" />
        <p className="text-white font-medium">{title}</p>
        <p className="text-white/60 text-sm mt-1">{description}</p>
      </div>
    </div>
  )
}

/**
 * Success step — glass card
 */
export function SuccessStep({
  title = "Success!",
  description = "Redirecting...",
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="rounded-2xl bg-black/30 backdrop-blur-xl border border-white/[0.12] shadow-2xl">
      <div className="py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <p className="text-white font-medium text-lg">{title}</p>
        <p className="text-white/60 text-sm mt-1">{description}</p>
      </div>
    </div>
  )
}

/**
 * Submit button with loading state — glass-themed
 */
export function SubmitButton({
  children,
  isLoading,
  disabled,
  onClick,
  className = "w-full h-12",
}: {
  children: React.ReactNode
  isLoading?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <Button
      className={`${className} bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm transition-all active:scale-[1.03]`}
      onClick={onClick}
      disabled={isLoading || disabled}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
      {children}
    </Button>
  )
}

/**
 * Divider with "or" text — glass-compatible
 */
export function OrDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-white/15" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="px-2 text-white/40 bg-transparent backdrop-blur-sm">or</span>
      </div>
    </div>
  )
}
