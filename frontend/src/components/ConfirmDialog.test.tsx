import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('moves focus into the dialog on open, and closes on Escape and Cancel', async () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn();

    const { rerender } = render(
      <ConfirmDialog
        isOpen={false}
        title="Delete Item"
        message="Are you sure you want to delete this?"
        onClose={handleClose}
        onConfirm={handleConfirm}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <ConfirmDialog
        isOpen={true}
        title="Delete Item"
        message="Are you sure you want to delete this?"
        onClose={handleClose}
        onConfirm={handleConfirm}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();

    // Focus moves into the dialog (Cancel button)
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => {
      expect(document.activeElement).toBe(cancelBtn);
    });

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Click Cancel
    fireEvent.click(cancelBtn);
    expect(handleClose).toHaveBeenCalledTimes(2);

    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it('triggers onConfirm when confirm button is clicked', () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Delete Item"
        message="Are you sure you want to delete this?"
        confirmLabel="Confirm Delete"
        variant="danger"
        onClose={handleClose}
        onConfirm={handleConfirm}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Delete' });
    expect(confirmBtn).toBeInTheDocument();
    // Clearly destructive variant
    expect(confirmBtn.className).toContain('bg-rose-600');

    fireEvent.click(confirmBtn);
    expect(handleConfirm).toHaveBeenCalledTimes(1);
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('keeps confirm button disabled when isConfirmDisabled or confirmDisabled is true', () => {
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Delete Group"
        message="Confirm group deletion"
        confirmLabel="Delete group"
        confirmDisabled={true}
        onConfirm={handleConfirm}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Delete group' });
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(handleConfirm).not.toHaveBeenCalled();
  });
});
