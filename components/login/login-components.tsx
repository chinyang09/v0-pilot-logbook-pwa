"use client"

import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
 * Error alert component for login forms
 */
export function LoginErrorAlert({ error }: { error: string }) {
  if (!error) return null

  return (
    <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>{error}</span>
    </div>
  )
}

/**
 * Back button for step navigation
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
      className="w-fit -ml-2 mb-2"
      onClick={onClick}
      disabled={disabled}
    >
      <ArrowLeft className="h-4 w-4 mr-1" />
      Back
    </Button>
  )
}

/**
 * Step card wrapper component
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
    <Card className="border-border">
      <CardHeader>
        {showBack && onBack && <StepBackButton onClick={onBack} />}
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginErrorAlert error={error || ""} />
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * Loading step card
 */
export function LoadingStep({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Card className="border-border">
      <CardContent className="py-12 text-center">
        <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
        <p className="text-foreground font-medium">{title}</p>
        <p className="text-muted-foreground text-sm mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

/**
 * Success step card
 */
export function SuccessStep({
  title = "Success!",
  description = "Redirecting...",
}: {
  title?: string
  description?: string
}) {
  return (
    <Card className="border-border">
      <CardContent className="py-12 text-center">
        <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
        <p className="text-foreground font-medium">{title}</p>
        <p className="text-muted-foreground text-sm mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

/**
 * Submit button with loading state
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
    <Button className={className} onClick={onClick} disabled={isLoading || disabled}>
      {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
      {children}
    </Button>
  )
}

/**
 * Divider with "Or" text
 */
export function OrDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-card px-2 text-muted-foreground">Or</span>
      </div>
    </div>
  )
}
