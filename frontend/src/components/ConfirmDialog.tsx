import React, { useEffect, useRef } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  confirmLabel?: string;
  cancelText?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  isConfirmDisabled?: boolean;
  confirmDisabled?: boolean;
  loading?: boolean;
  isLoading?: boolean;
  children?: React.ReactNode;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  message,
  confirmText,
  confirmLabel,
  cancelText,
  cancelLabel,
  variant = 'danger',
  isConfirmDisabled,
  confirmDisabled,
  loading,
  isLoading,
  children,
}) => {
  const handleClose = onCancel || onClose || (() => {});
  const resolvedConfirmText = confirmLabel || confirmText || 'Delete';
  const resolvedCancelText = cancelLabel || cancelText || 'Cancel';
  const resolvedLoading = isLoading ?? loading ?? false;
  const resolvedDisabled = confirmDisabled ?? isConfirmDisabled ?? false;

  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management: move focus into the dialog on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (cancelButtonRef.current) {
          cancelButtonRef.current.focus();
        } else if (dialogRef.current) {
          dialogRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        tabIndex={-1}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-neutral-200 p-6 space-y-5 focus:outline-none"
      >
        <div className="space-y-2">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-bold text-neutral-900 tracking-tight"
          >
            {title}
          </h2>
          <div id="confirm-dialog-desc" className="text-sm text-neutral-600 leading-relaxed">
            {message}
          </div>
        </div>

        {children && <div className="space-y-4">{children}</div>}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={resolvedLoading}
          >
            {resolvedCancelText}
          </Button>

          <Button
            type="button"
            variant={variant}
            size="sm"
            onClick={onConfirm}
            loading={resolvedLoading}
            disabled={resolvedDisabled || resolvedLoading}
          >
            {resolvedConfirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};
