import React from 'react';

export interface BadgeProps {
  status:
    | 'open'
    | 'closed'
    | 'approved'
    | 'pending'
    | 'unclaimed'
    | 'inactive'
    | 'late'
    | 'not_claimed'
    | 'waiting'
    | 'claimed';
  label?: string;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ status, label, className = '' }) => {
  const config = {
    open: {
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: 'Open',
    },
    closed: {
      bg: 'bg-neutral-100 text-neutral-600 border-neutral-300',
      label: 'Closed',
    },
    approved: {
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: 'Approved',
    },
    claimed: {
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: 'Claimed',
    },
    pending: {
      bg: 'bg-amber-50 text-amber-700 border-amber-200',
      label: 'Pending',
    },
    waiting: {
      bg: 'bg-amber-50 text-amber-700 border-amber-200',
      label: 'Waiting for approval',
    },
    unclaimed: {
      bg: 'bg-neutral-100 text-neutral-600 border-neutral-200',
      label: 'Unclaimed',
    },
    not_claimed: {
      bg: 'bg-neutral-100 text-neutral-600 border-neutral-200',
      label: 'Not claimed',
    },
    inactive: {
      bg: 'bg-rose-50 text-rose-700 border-rose-200',
      label: 'Inactive',
    },
    late: {
      bg: 'bg-rose-50 text-rose-700 border-rose-200',
      label: 'Late',
    },
  }[status] || {
    bg: 'bg-neutral-100 text-neutral-700 border-neutral-200',
    label: status,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.bg} ${className}`.trim()}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {label || config.label}
    </span>
  );
};

