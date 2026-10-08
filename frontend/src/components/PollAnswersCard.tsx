import React, { useEffect, useState } from 'react';
import type { PublicPollField } from '../api/types';
import { saveAnswers } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import {
  initialAnswerValues,
  toAnswersPayload,
  validateAnswers,
} from '../lib/answersForm';
import { formatDateTime } from '../lib/time';
import { Card } from './Card';
import { Button } from './Button';
import { Banner } from './Banner';

export interface PollAnswersCardProps {
  pollId: string;
  pollFields: PublicPollField[];
  savedAnswers?: Record<string, string | number | null> | null;
  savedUpdatedAt?: string | null;
  isClosed: boolean;
  memberToken: string;
  onAnswersSaved: (
    answers: Record<string, string | number | null>,
    updatedAt: string | null,
  ) => void;
  onUnauthorized: () => void;
  className?: string;
}

export const PollAnswersCard: React.FC<PollAnswersCardProps> = ({
  pollId,
  pollFields,
  savedAnswers,
  savedUpdatedAt,
  isClosed,
  memberToken,
  onAnswersSaved,
  onUnauthorized,
  className = '',
}) => {
  const sortedFields = [...pollFields].sort((a, b) => a.position - b.position);

  const [formValues, setFormValues] = useState<Record<string, string>>(() =>
    initialAnswerValues(sortedFields, savedAnswers),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    savedUpdatedAt ?? null,
  );

  // Sync form values if savedAnswers prop changes from outside
  useEffect(() => {
    setFormValues(initialAnswerValues(sortedFields, savedAnswers));
    if (savedUpdatedAt !== undefined) {
      setLastSavedAt(savedUpdatedAt);
    }
  }, [savedAnswers, savedUpdatedAt]);

  if (sortedFields.length === 0) {
    return null;
  }

  // Check if any required field has no saved value
  const hasMissingRequiredSaved = sortedFields.some((f) => {
    if (!f.is_required) return false;
    const val = savedAnswers?.[f.key];
    return val === undefined || val === null || String(val).trim() === '';
  });

  // Check if form differs from current saved values (or defaults)
  const baseline = initialAnswerValues(sortedFields, savedAnswers);
  const hasChanged = sortedFields.some(
    (f) => (formValues[f.key] ?? '').trim() !== (baseline[f.key] ?? '').trim(),
  );

  const handleChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isClosed || isSaving || !hasChanged) return;

    // Client-side validation checks
    const clientErrors = validateAnswers(sortedFields, formValues);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setIsSaving(true);
    setGeneralError(null);
    setFieldErrors({});

    try {
      const payload = toAnswersPayload(sortedFields, formValues);
      const res = await saveAnswers(pollId, payload, memberToken);
      setLastSavedAt(res.answers_updated_at);
      onAnswersSaved(res.answers, res.answers_updated_at);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.code === 'invalid_token') {
          onUnauthorized();
          return;
        }
        if (err.details && err.details.length > 0) {
          const mapped: Record<string, string> = {};
          for (const d of err.details) {
            if (d.field) {
              const matched = sortedFields.find(
                (f) =>
                  f.key === d.field ||
                  f.name.toLowerCase() === d.field?.toLowerCase(),
              );
              if (matched) {
                mapped[matched.key] = d.message;
              } else {
                mapped[d.field] = d.message;
              }
            }
          }
          setFieldErrors(mapped);
        }
        setGeneralError(getFriendlyErrorMessage(err));
      } else {
        setGeneralError(getFriendlyErrorMessage(err));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className={`space-y-4 ${className}`.trim()}>
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-neutral-900">
          Your details for this poll
        </h2>
        <p className="text-sm text-neutral-600">
          The poll creator requested these details alongside your vote.
        </p>
      </div>

      {/* Gentle note for missing required answers */}
      {!isClosed && hasMissingRequiredSaved && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium">
          Please fill in the required details so the poll creator has everything.
        </div>
      )}

      {/* Closed poll notice */}
      {isClosed && (
        <div className="p-3 bg-neutral-100 border border-neutral-200 rounded-xl text-xs text-neutral-700 font-medium">
          This poll is closed.
        </div>
      )}

      {generalError && (
        <Banner type="error" title="Could not save answers">
          {generalError}
        </Banner>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {sortedFields.map((field) => {
          const val = formValues[field.key] ?? '';
          const fieldError = fieldErrors[field.key];

          return (
            <div key={field.key} className="space-y-1.5">
              <label
                htmlFor={`field-${field.key}`}
                className="block text-sm font-semibold text-neutral-800"
              >
                {field.name}
                {field.is_required && (
                  <span className="text-xs font-normal text-rose-500 ml-1.5">
                    Required
                  </span>
                )}
              </label>

              {isClosed ? (
                <div
                  id={`field-${field.key}`}
                  className="px-3.5 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-700 text-sm min-h-[44px] flex items-center"
                >
                  {val || <span className="text-neutral-400 italic">None</span>}
                </div>
              ) : field.field_type === 'choice' ? (
                <select
                  id={`field-${field.key}`}
                  value={val}
                  disabled={isSaving}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-neutral-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px] text-sm ${
                    fieldError ? 'border-rose-500' : 'border-neutral-300'
                  }`}
                >
                  {(!field.is_required || !val) && (
                    <option value="">Select an option...</option>
                  )}
                  {field.choices?.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : field.field_type === 'number' ? (
                <input
                  id={`field-${field.key}`}
                  type="text"
                  inputMode="decimal"
                  value={val}
                  disabled={isSaving}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder="e.g. 12.5"
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-neutral-900 placeholder:text-neutral-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px] text-sm ${
                    fieldError ? 'border-rose-500' : 'border-neutral-300'
                  }`}
                />
              ) : field.field_type === 'link' ? (
                <input
                  id={`field-${field.key}`}
                  type="url"
                  inputMode="url"
                  value={val}
                  disabled={isSaving}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder="https://..."
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-neutral-900 placeholder:text-neutral-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px] text-sm ${
                    fieldError ? 'border-rose-500' : 'border-neutral-300'
                  }`}
                />
              ) : (
                <input
                  id={`field-${field.key}`}
                  type="text"
                  value={val}
                  disabled={isSaving}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={`Enter ${field.name.toLowerCase()}`}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-neutral-900 placeholder:text-neutral-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px] text-sm ${
                    fieldError ? 'border-rose-500' : 'border-neutral-300'
                  }`}
                />
              )}

              {fieldError && (
                <p className="text-xs text-rose-600 font-medium">{fieldError}</p>
              )}
            </div>
          );
        })}

        {!isClosed && (
          <div className="pt-2 flex items-center justify-between gap-3">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isSaving || !hasChanged}
              loading={isSaving}
            >
              Save answers
            </Button>

            {lastSavedAt && (
              <span className="text-xs text-emerald-700 font-medium">
                Saved {formatDateTime(lastSavedAt)}
              </span>
            )}
          </div>
        )}
      </form>
    </Card>
  );
};
