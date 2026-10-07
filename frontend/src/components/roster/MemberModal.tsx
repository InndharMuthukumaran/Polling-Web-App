import React, { useEffect, useState } from 'react';
import type { GroupField, GroupMember } from '../../api/types';
import { toMemberPayload, validateMemberForm } from '../../lib/rosterForm';
import { ApiError, getFriendlyErrorMessage } from '../../api/client';
import { Button } from '../Button';
import { Banner } from '../Banner';

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  fields: GroupField[];
  member?: GroupMember | null;
  onSave: (displayName: string, values: Record<string, string | number | null>) => Promise<void>;
}

export const MemberModal: React.FC<MemberModalProps> = ({
  isOpen,
  onClose,
  fields,
  member,
  onSave,
}) => {
  const isEdit = Boolean(member);
  const [displayName, setDisplayName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setClientErrors({});
    setServerErrors({});
    setGeneralError(null);

    if (member) {
      setDisplayName(member.display_name);
      const initVals: Record<string, string> = {};
      for (const f of fields) {
        const existing = member.values?.[f.key];
        initVals[f.key] = existing !== undefined && existing !== null ? String(existing) : '';
      }
      setValues(initVals);
    } else {
      setDisplayName('');
      const initVals: Record<string, string> = {};
      for (const f of fields) {
        initVals[f.key] = f.default_value ?? '';
      }
      setValues(initVals);
    }
  }, [isOpen, member, fields]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setGeneralError(null);
    setServerErrors({});

    // Client-side checks
    const errs = validateMemberForm(fields, values, displayName);
    if (Object.keys(errs).length > 0) {
      setClientErrors(errs);
      return;
    }
    setClientErrors({});

    setLoading(true);
    try {
      const payloadValues = toMemberPayload(fields, values, isEdit);
      await onSave(displayName.trim(), payloadValues);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setGeneralError(err.message);
        if (err.details && err.details.length > 0) {
          const sErrs: Record<string, string> = {};
          for (const d of err.details) {
            if (d.field) {
              // Match either key or field name (case-insensitive)
              const matched = fields.find(
                (f) =>
                  f.key === d.field ||
                  f.name.toLowerCase() === d.field?.toLowerCase(),
              );
              if (matched) {
                sErrs[matched.key] = d.message;
              } else if (d.field.toLowerCase() === 'name' || d.field.toLowerCase() === 'display_name') {
                sErrs.name = d.message;
              } else {
                sErrs[d.field] = d.message;
              }
            }
          }
          setServerErrors(sErrs);
        }
      } else {
        setGeneralError(getFriendlyErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const sortedFields = [...fields].sort((a, b) => a.position - b.position);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-neutral-200 overflow-hidden my-8">
        <div className="p-5 border-b border-neutral-100 flex items-center justify-between">
          <h2 id="member-modal-title" className="text-base font-bold text-neutral-900">
            {isEdit ? 'Edit Member' : 'Add New Member'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {generalError && <Banner type="error">{generalError}</Banner>}

          {/* Display Name Input */}
          <div>
            <label htmlFor="member-display-name" className="block text-xs font-semibold text-neutral-700 mb-1">
              Display Name *
            </label>
            <input
              id="member-display-name"
              type="text"
              required
              placeholder="e.g. Alice Cooper"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
            {clientErrors.name && (
              <p className="text-xs text-rose-600 mt-1 font-medium">{clientErrors.name}</p>
            )}
            {serverErrors.name && (
              <p className="text-xs text-rose-600 mt-1 font-medium">{serverErrors.name}</p>
            )}
          </div>

          {/* Dynamic Field Inputs */}
          {sortedFields.map((field) => {
            const val = values[field.key] ?? '';
            const fieldError = clientErrors[field.key] || serverErrors[field.key];

            return (
              <div key={field.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor={`field-input-${field.key}`} className="block text-xs font-semibold text-neutral-700">
                    {field.name}
                    {field.is_required && <span className="text-rose-500 ml-0.5">*</span>}
                    {field.is_identifier && (
                      <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Identifier
                      </span>
                    )}
                  </label>
                  {field.is_required && (
                    <span className="text-[11px] text-neutral-400 font-normal">Required</span>
                  )}
                </div>

                {field.field_type === 'choice' ? (
                  <select
                    id={`field-input-${field.key}`}
                    value={val}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                  >
                    {!field.is_required && <option value="">Choose...</option>}
                    {field.choices?.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`field-input-${field.key}`}
                    type={field.field_type === 'number' ? 'number' : field.field_type === 'link' ? 'url' : 'text'}
                    placeholder={
                      field.field_type === 'link'
                        ? 'https://example.com'
                        : field.default_value
                        ? `Default: ${field.default_value}`
                        : ''
                    }
                    value={val}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                )}

                {fieldError && (
                  <p className="text-xs text-rose-600 font-medium">{fieldError}</p>
                )}
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-neutral-100">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              {isEdit ? 'Save Changes' : 'Add Member'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
