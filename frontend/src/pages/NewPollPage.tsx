import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { createPoll } from '../api/endpoints';
import { getFriendlyErrorMessage } from '../api/client';
import { getAdmin } from '../lib/adminStorage';
import {
  toCreatePayload,
  validatePollForm,
  type PollFieldError,
  type PollFormOption,
  type PollFormValues,
} from '../lib/pollForm';
import type { CompletionTimeMode, PollOptionRole } from '../api/types';

export const NewPollPage: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [completionTimeMode, setCompletionTimeMode] = useState<CompletionTimeMode>('last');

  const [options, setOptions] = useState<PollFormOption[]>([
    { label: 'Yes', role: 'target' },
    { label: 'Not yet', role: 'not_yet' },
  ]);

  const [fieldErrors, setFieldErrors] = useState<PollFieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick fill handlers
  const handleQuickFillYesNo = () => {
    setOptions([
      { label: 'Yes', role: 'target' },
      { label: 'Not yet', role: 'not_yet' },
    ]);
  };

  const handleQuickFillStages = () => {
    setOptions([
      { label: 'Part 1', role: 'in_progress' },
      { label: 'Part 2', role: 'in_progress' },
      { label: 'Part 3 completed', role: 'target' },
    ]);
  };

  const handleAddExcusedOption = () => {
    setOptions((prev) => [...prev, { label: 'Need more time', role: 'excused' }]);
  };

  const handleAddRow = () => {
    setOptions((prev) => [...prev, { label: '', role: 'not_yet' }]);
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
      completionTimeMode,
      options,
    };

    const errors = validatePollForm(formValues);
    setFieldErrors(errors);
    if (errors.length > 0) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload = toCreatePayload(formValues);
      const res = await createPoll(groupId, admin.adminToken, payload);
      navigate(`/g/${groupId}/polls/${res.id}`);
    } catch (err) {
      setSubmitError(getFriendlyErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameError = fieldErrors.find((e) => e.field === 'name')?.message;
  const optionsError = fieldErrors.find((e) => e.field === 'options')?.message;

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

          {/* CARD 2: Deadline and Completion Time Mode */}
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
            </div>

            <div className="pt-2 border-t border-neutral-100 space-y-2">
              <label className="block text-xs font-semibold text-neutral-700">
                How should the deadline be judged?
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer select-none p-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50">
                  <input
                    type="radio"
                    name="completion_time_mode"
                    value="last"
                    checked={completionTimeMode === 'last'}
                    onChange={() => setCompletionTimeMode('last')}
                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-neutral-900 block">
                      When the member settled on the target (their most recent selection). Recommended.
                    </span>
                    <span className="text-neutral-500">
                      Evaluates whether their final target selection was made on time.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer select-none p-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50">
                  <input
                    type="radio"
                    name="completion_time_mode"
                    value="first"
                    checked={completionTimeMode === 'first'}
                    onChange={() => setCompletionTimeMode('first')}
                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-neutral-900 block">
                      The first time they ever selected the target.
                    </span>
                    <span className="text-neutral-500">
                      Evaluates completion the very first time the target option was clicked.
                    </span>
                  </div>
                </label>
              </div>
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
                Define the choices. At least one must be designated as the target.
              </p>
            </div>

            {/* Quick-fill button bar */}
            <div className="flex gap-2 flex-wrap pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleQuickFillYesNo}
              >
                Yes / Not yet
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleQuickFillStages}
              >
                Stages
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAddExcusedOption}
              >
                Add &quot;Need more time&quot; option
              </Button>
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
                      placeholder={`Option label (e.g. Yes, Step 1)`}
                      value={option.label}
                      onChange={(e) => handleOptionChange(idx, e.target.value, option.role)}
                      className="w-full px-3 py-2 text-sm bg-white rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
                    />

                    <select
                      value={option.role}
                      onChange={(e) =>
                        handleOptionChange(idx, option.label, e.target.value as PollOptionRole)
                      }
                      className="w-full px-3 py-2 text-xs bg-white rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
                    >
                      <option value="target">Target (counts as done)</option>
                      <option value="in_progress">In progress</option>
                      <option value="excused">Needs more time / excused</option>
                      <option value="not_yet">Not yet</option>
                    </select>
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

          <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
            Create Poll
          </Button>
        </form>
      </div>
    </div>
  );
};
