"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ModelDeleteActionProps {
  modelName: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}

export function ModelDeleteAction({
  modelName,
  disabled = false,
  onConfirm,
}: ModelDeleteActionProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsDeleting(true);
      await onConfirm();
      setOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Delete ${modelName}`}
        className="h-8 rounded-lg border-red-200 bg-white/65 px-3 text-xs font-bold text-red-600 hover:bg-red-50"
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        Delete
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="glass-strong border-gray-200/60 shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-xl font-bold">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete catalog model
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500">
              This removes <span className="font-semibold text-gray-700">{modelName}</span> from
              the admin catalog. Existing Builder selections that reference it may need manual
              replacement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel
              disabled={isDeleting}
              className="rounded-xl border-gray-200 hover:bg-gray-50"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirm();
              }}
              disabled={isDeleting}
              className="rounded-xl bg-red-600 text-white shadow-md hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Model"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
