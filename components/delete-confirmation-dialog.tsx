"use client"

import { useState, useCallback } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export interface DeleteConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void> | void
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  isDeleting?: boolean
}

export function DeleteConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Delete Item",
  description = "Are you sure you want to delete this item? This action cannot be undone.",
  confirmText = "Delete",
  cancelText = "Cancel",
  isDeleting = false,
}: DeleteConfirmationDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting..." : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export interface UseDeleteConfirmationReturn<T> {
  /** The item targeted for deletion */
  deleteTarget: T | null
  /** Whether deletion is in progress */
  isDeleting: boolean
  /** Open the delete confirmation dialog */
  confirmDelete: (item: T) => void
  /** Cancel the deletion */
  cancelDelete: () => void
  /** Handle the actual deletion */
  handleDelete: (deleteFn: (item: T) => Promise<void> | void) => Promise<void>
  /** Dialog component to render */
  DeleteDialog: (props: Omit<DeleteConfirmationDialogProps, "open" | "onOpenChange" | "onConfirm" | "isDeleting">) => JSX.Element
}

/**
 * Hook for managing delete confirmation dialogs
 *
 * @example
 * ```tsx
 * const { deleteTarget, confirmDelete, handleDelete, DeleteDialog } = useDeleteConfirmation<Flight>()
 *
 * return (
 *   <>
 *     <Button onClick={() => confirmDelete(flight)}>Delete</Button>
 *     <DeleteDialog
 *       title="Delete Flight"
 *       description="Are you sure you want to delete this flight?"
 *     />
 *   </>
 * )
 * ```
 */
export function useDeleteConfirmation<T = unknown>(): UseDeleteConfirmationReturn<T> {
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const confirmDelete = useCallback((item: T) => {
    setDeleteTarget(item)
  }, [])

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null)
    setIsDeleting(false)
  }, [])

  const handleDelete = useCallback(
    async (deleteFn: (item: T) => Promise<void> | void) => {
      if (!deleteTarget) return

      setIsDeleting(true)
      try {
        await deleteFn(deleteTarget)
      } finally {
        setIsDeleting(false)
        setDeleteTarget(null)
      }
    },
    [deleteTarget]
  )

  const DeleteDialog = useCallback(
    (props: Omit<DeleteConfirmationDialogProps, "open" | "onOpenChange" | "onConfirm" | "isDeleting">) => (
      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && cancelDelete()}
        onConfirm={() => handleDelete((item) => props.onConfirm?.())}
        isDeleting={isDeleting}
        {...props}
      />
    ),
    [deleteTarget, isDeleting, cancelDelete, handleDelete]
  )

  return {
    deleteTarget,
    isDeleting,
    confirmDelete,
    cancelDelete,
    handleDelete,
    DeleteDialog,
  }
}
