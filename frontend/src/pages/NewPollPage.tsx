import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Spinner } from '../components/Spinner';
import { createPoll, getGroup } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage, getLimits, getCachedLimits } from '../api/client';
import { getAdmin } from '../lib/adminStorage';
import {
  ROLE_DEFINITIONS,
  getRoleHelpText,
  toCreatePayload,
  validatePollForm,
  type PollFieldError,
  type PollFormOption,
  type PollFormValues,
  type PollOnlyFieldDraft,
} from '../lib/pollForm';
import type { ApiLimits, FieldType, GroupField, PollOptionRole } from '../api/types';

export const NewPollPage: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [deadlineLocal, setDeadlineLocal] = useState('');

  const [limits, setLimits] = useState<ApiLimits>(getCachedLimits());

  const [options, setOptions] = useState<PollFormOption[]>([
    { label: '', role: 'target' },
    { label: '', role: 'not_yet' },
  ]);

  // Group fields for included columns
  const [groupFields, setGroupFields] = useState<GroupField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [includedFieldIds, setIncludedFieldIds] = useState<string[]>([]);

  // Poll-only questions
  const [pollFields, setPollFields] = useState<PollOnlyFieldDraft[]>([]);

  const [fieldErrors, setFieldErrors] = useState<PollFieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    getLimits()
      .then((lim) => {
        if (mounted) {
          setLimits(lim);
        }
      })
      .catch(() => {});

    if (!groupId) {
      setLoadingFields(false);
      return;
    }
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) {
      setLoadingFields(false);
      return;
    }

    getGroup(groupId, admin.adminToken)
      .then((res) => {
        if (mounted) {
          setGroupFields(res.fields || []);
          setLoadingFields(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadingFields(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [groupId]);

  const handleAddRow = () => {
    setOptions((prev) => [
      ...prev,
      { label: '', role: prev.length === 0 ? 'target' : 'not_yet' },
    ]);
  };

  const handleRemoveRow = (index: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, label: string, role: PollOptionRole) => {
    setOptions((prev) =>
      prev.map((opt, i) => (i === index ? { ...opt, label, role } : opt)),
    );
  };

  // Included fields handler
  const handleToggleIncludedField = (fieldId: string) => {
    setIncludedFieldIds((prev) =>
      prev.includes(fieldId) ? prev.filter((id) => id !== fieldId) : [...prev, fieldId],
    );
  };

  // Poll-only questions handlers
  const handleAddPollField = () => {
    if (pollFields.length >= limits.max_poll_fields) return;
    setPollFields((prev) => [
      ...prev,
      {
        id: `pf-${Date.now()}-${Math.random()}`,
        name: '',
        field_type: 'text',
        is_required: false,
        default_value: '',
        choicesText: '',
      },
    ]);
  };

  const handleRemovePollField = (idx: number) => {
    setPollFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdatePollField = (idx: number, updates: Partial<PollOnlyFieldDraft>) => {
    setPollFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId) return;

    const admin = getAdmin(groupId);
    if (!admin?.adminToken) {
      setSubmitError('Your creator access token was not found on this device.');
      return;
    }

    const formValues: PollFormValues = {
      name,
      description,
      allowMultiple,
      deadlineLocal,
      completionTimeMode: 'last',
      options,
      includedFieldIds,
      pollFields,
    };

    const errors = validatePollForm(formValues, groupFields);
    setFieldErrors(errors);
    if (errors.length > 0) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload = toCreatePayload(formValues, groupFields);
      const res = await createPoll(groupId, admin.adminToken, payload);
      navigate(`/g/${groupId}/polls/${res.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details && err.details.length > 0) {
        const serverErrors: PollFieldError[] = err.details.map((d) => ({
          field: d.field || 'general',
          message: d.message,
        }));
        setFieldErrors((prev) => [...prev, ...serverErrors]);
      }
      setSubmitError(getFriendlyErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameError = fieldErrors.find((e) => e.field === 'name')?.message;
  const optionsError = fieldErrors.find((e) => e.field === 'options')?.message;
  const pollFieldsMaxError = fieldErrors.find((e) => e.field === 'pollFields')?.message;

  const getFieldError = (exactField: string) => {
    return fieldErrors.find(
      (e) =>
        e.field === exactField ||
        e.field.endsWith(`.${exactField}`) ||
        e.field === exactField.replace('pollFields.', 'poll_fields.'),
    )?.message;
  };

  const identifierField = groupFields.find((f) => f.is_identifier);
  const regularFields = groupFields
    .filter((f) => !f.is_identifier)
    .sort((a, b) => a.position - b.position);

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        {/* Navigation */}
        <div className="space-y-1">
          <Link
            to={`/g/${groupId}`}
            className="inline-flex items-center text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Create a New Poll</h1>
        </div>

        {submitError && <Banner type="error">{submitError}</Banner>}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* CARD 1: Poll Basic Info */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="poll-name-input" className="block text-xs font-semibold text-neutral-700">
                Poll Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="poll-name-input"
                type="text"
                placeholder="e.g. Assignment 3 Submission, Weekend Attendance"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl border text-neutral-900 text-sm focus:outline-none focus:ring-2 min-h-[44px] ${
                  nameError
                    ? 'border-rose-400 focus:ring-rose-500'
                    : 'border-neutral-300 focus:ring-indigo-600'
                }`}
              />
              {nameError && <p className="text-xs text-rose-600 font-medium">{nameError}</p>}
            </div>

            <div className="space-y-1">
              <label htmlFor="poll-desc-input" className="block text-xs font-semibold text-neutral-700">
                Description (Optional)
              </label>
              <textarea
                id="poll-desc-input"
                rows={2}
                placeholder="Instructions or guidelines for members..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            <div className="pt-2 border-t border-neutral-100">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allowMultiple}
                  onChange={(e) => setAllowMultiple(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                />
                <span className="text-sm font-medium text-neutral-800">
                  Allow multiple choices
                </span>
              </label>
            </div>
          </Card>

          {/* CARD 2: Deadline */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="poll-deadline-input" className="block text-xs font-semibold text-neutral-700">
                Deadline (Optional)
              </label>
              <p className="text-xs text-neutral-500">
                Select deadline in your local time zone.
              </p>
              <input
                id="poll-deadline-input"
                type="datetime-local"
                value={deadlineLocal}
                onChange={(e) => setDeadlineLocal(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
              />
              <p className="text-xs text-neutral-500 leading-relaxed pt-1">
                A member is on time if they settled on a target option before the deadline (their most recent choice counts). Anyone who finishes later still counts as done and is marked late. The poll is complete only when everyone, except excused members, has reached a target option.
              </p>
            </div>
          </Card>

          {/* CARD 3: Options Editor */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-neutral-900">Poll Options</h2>
                <span className="text-xs text-neutral-500 font-medium">Minimum 2</span>
              </div>
              <p className="text-xs text-neutral-600">
                Name your options anything you like, and choose what each one means.
              </p>
            </div>

            {optionsError && <p className="text-xs text-rose-600 font-medium">{optionsError}</p>}

            {/* Option Rows */}
            <div className="space-y-2.5">
              {options.map((option, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-neutral-600 uppercase">
                      Option {idx + 1}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove option ${idx + 1}`}
                      disabled={options.length <= 2}
                      onClick={() => handleRemoveRow(idx)}
                      className="text-xs text-neutral-400 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="text"
                      placeholder="Option name"
                      value={option.label}
                      onChange={(e) => handleOptionChange(idx, e.target.value, option.role)}
                      className="w-full px-3 py-2 text-sm bg-white rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
                    />

                    <div>
                      <select
                        aria-label={`Option ${idx + 1} role`}
                        value={option.role}
                        onChange={(e) =>
                          handleOptionChange(idx, option.label, e.target.value as PollOptionRole)
                        }
                        className="w-full px-3 py-2 text-xs bg-white rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
                      >
                        {ROLE_DEFINITIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-neutral-500 mt-1">
                        {getRoleHelpText(option.role)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="md"
              fullWidth
              onClick={handleAddRow}
            >
              + Add another option
            </Button>
          </Card>

          {/* CARD 4: Roster Columns for Your Results */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-neutral-900">
                Roster columns for your results
              </h2>
              <p className="text-xs text-neutral-600">
                Only you can see these. Members never see other people&apos;s details.
              </p>
            </div>

            {loadingFields ? (
              <div className="py-3 flex items-center gap-2 text-xs text-neutral-500">
                <Spinner size="sm" label="Loading roster fields..." />
                <span>Loading roster fields...</span>
              </div>
            ) : groupFields.length === 0 ? (
              <p className="text-xs text-neutral-500">
                Your roster has no extra fields yet.{' '}
                <Link
                  to={`/g/${groupId}/roster`}
                  className="text-indigo-600 underline font-medium"
                >
                  Go to roster page
                </Link>
              </p>
            ) : (
              <div className="space-y-2">
                {identifierField && (
                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-neutral-50 border border-neutral-200 opacity-90 cursor-not-allowed select-none">
                    <input
                      type="checkbox"
                      checked={true}
                      disabled={true}
                      className="mt-0.5 text-indigo-600 rounded border-neutral-300 cursor-not-allowed"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-neutral-900 block">
                        {identifierField.name}
                      </span>
                      <span className="text-neutral-500">
                        Always included so you can tell people apart.
                      </span>
                    </div>
                  </label>
                )}

                {regularFields.map((f) => (
                  <label
                    key={f.id}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 cursor-pointer select-none transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={includedFieldIds.includes(f.id)}
                      onChange={() => handleToggleIncludedField(f.id)}
                      className="text-indigo-600 rounded border-neutral-300 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-medium text-neutral-800">
                      {f.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Card>

          {/* CARD 5: Questions for Members (Optional) */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-neutral-900">
                  Questions for members (optional)
                </h2>
                <span className="text-xs text-neutral-500 font-medium">
                  {pollFields.length} / {limits.max_poll_fields}
                </span>
              </div>
              <p className="text-xs text-neutral-600">
                Members answer these on the poll page, next to their vote. You cannot change them
                after creating the poll.
              </p>
            </div>

            {pollFieldsMaxError && (
              <p className="text-xs text-rose-600 font-medium">{pollFieldsMaxError}</p>
            )}

            {pollFields.map((f, idx) => {
              const nameErr = getFieldError(`pollFields.${idx}.name`);
              const choicesErr = getFieldError(`pollFields.${idx}.choices`);
              const defaultErr = getFieldError(`pollFields.${idx}.defaultValue`);
              const parsedChoices = f.choicesText
                .split('\n')
                .map((c) => c.trim())
                .filter(Boolean);

              return (
                <div
                  key={f.id}
                  className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-neutral-600 uppercase">
                      Question {idx + 1}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove question"
                      onClick={() => handleRemovePollField(idx)}
                      className="text-xs text-neutral-400 hover:text-rose-600 transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="space-y-2">
                    {/* Question Name */}
                    <div className="space-y-1">
                      <label
                        htmlFor={`q-name-${idx}`}
                        className="block text-[11px] font-semibold text-neutral-700"
                      >
                        Question Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id={`q-name-${idx}`}
                        type="text"
                        placeholder="e.g. Expected CTC, T-Shirt Size, GitHub Profile"
                        value={f.name}
                        onChange={(e) => handleUpdatePollField(idx, { name: e.target.value })}
                        className={`w-full px-3 py-2 text-sm bg-white rounded-lg border text-neutral-900 focus:outline-none focus:ring-2 min-h-[40px] ${
                          nameErr
                            ? 'border-rose-400 focus:ring-rose-500'
                            : 'border-neutral-300 focus:ring-indigo-600'
                        }`}
                      />
                      {nameErr && <p className="text-[11px] text-rose-600 font-medium">{nameErr}</p>}
                    </div>

                    {/* Question Type & Required */}
                    <div className="grid grid-cols-2 gap-2 items-center">
                      <div className="space-y-1">
                        <label
                          htmlFor={`q-type-${idx}`}
                          className="block text-[11px] font-semibold text-neutral-700"
                        >
                          Type
                        </label>
                        <select
                          id={`q-type-${idx}`}
                          aria-label="Question type"
                          value={f.field_type}
                          onChange={(e) =>
                            handleUpdatePollField(idx, {
                              field_type: e.target.value as FieldType,
                              default_value: '',
                            })
                          }
                          className="w-full px-3 py-2 text-xs bg-white rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[40px]"
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="choice">Choice list</option>
                          <option value="link">Link</option>
                        </select>
                      </div>

                      <div className="pt-4">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={f.is_required}
                            onChange={(e) =>
                              handleUpdatePollField(idx, { is_required: e.target.checked })
                            }
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                          />
                          <span className="text-xs font-medium text-neutral-800">
                            Required
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Choice List Editor */}
                    {f.field_type === 'choice' && (
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-neutral-700">
                          Choices (one per line)
                        </label>
                        <textarea
                          rows={3}
                          placeholder="Small&#10;Medium&#10;Large"
                          value={f.choicesText}
                          onChange={(e) =>
                            handleUpdatePollField(idx, { choicesText: e.target.value })
                          }
                          className={`w-full px-3 py-2 text-xs bg-white rounded-lg border text-neutral-900 focus:outline-none focus:ring-2 ${
                            choicesErr
                              ? 'border-rose-400 focus:ring-rose-500'
                              : 'border-neutral-300 focus:ring-indigo-600'
                          }`}
                        />
                        {choicesErr && (
                          <p className="text-[11px] text-rose-600 font-medium">{choicesErr}</p>
                        )}
                      </div>
                    )}

                    {/* Default Value */}
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-neutral-700">
                        Default value (optional)
                      </label>
                      {f.field_type === 'choice' ? (
                        <select
                          value={f.default_value}
                          onChange={(e) =>
                            handleUpdatePollField(idx, { default_value: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs bg-white rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[40px]"
                        >
                          <option value="">No default</option>
                          {parsedChoices.map((choice, cIdx) => (
                            <option key={cIdx} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={f.field_type === 'number' ? 'number' : 'text'}
                          placeholder="Optional default..."
                          value={f.default_value}
                          onChange={(e) =>
                            handleUpdatePollField(idx, { default_value: e.target.value })
                          }
                          className={`w-full px-3 py-2 text-xs bg-white rounded-lg border text-neutral-900 focus:outline-none focus:ring-2 min-h-[40px] ${
                            defaultErr
                              ? 'border-rose-400 focus:ring-rose-500'
                              : 'border-neutral-300 focus:ring-indigo-600'
                          }`}
                        />
                      )}
                      {defaultErr && (
                        <p className="text-[11px] text-rose-600 font-medium">{defaultErr}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              variant="outline"
              size="md"
              fullWidth
              disabled={pollFields.length >= limits.max_poll_fields}
              onClick={handleAddPollField}
            >
              + Add question
            </Button>
          </Card>

          <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
            Create Poll
          </Button>
        </form>
      </div>
    </div>
  );
};
