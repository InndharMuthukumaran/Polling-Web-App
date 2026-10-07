import React, { useState } from 'react';
import type { FieldType, GroupField, GroupMember, ImportPreviewResponse, ImportResultResponse } from '../../api/types';
import {
  downloadMemberTemplate,
  importMembers,
  previewMemberImport,
} from '../../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../../api/client';
import { buildImportRequest, type ColumnChoice } from '../../lib/importMapping';
import { Button } from '../Button';
import { Card } from '../Card';
import { Banner } from '../Banner';

interface ImportTabProps {
  groupId: string;
  adminToken: string;
  fields: GroupField[];
  members: GroupMember[];
  onRefresh: () => Promise<void>;
  onSwitchToMembers: () => void;
}

export const ImportTab: React.FC<ImportTabProps> = ({
  groupId,
  adminToken,
  fields,
  members,
  onRefresh,
  onSwitchToMembers,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'xlsx' | 'csv' | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Mapping state
  const [columnChoices, setColumnChoices] = useState<Record<number, ColumnChoice>>({});
  const [onDuplicate, setOnDuplicate] = useState<'reject' | 'skip'>('reject');

  // Dry run / Check state
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<ImportResultResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkErrorDetails, setCheckErrorDetails] = useState<
    Array<{ row?: number; field?: string; message: string }>
  >([]);

  // Import final state
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const canBeIdentifier =
    members.length === 0 && !fields.some((f) => f.is_identifier);

  // STEP 1: Download Templates
  const handleDownloadTemplate = async (format: 'xlsx' | 'csv') => {
    setDownloadingFormat(format);
    setFileError(null);
    try {
      const result = await downloadMemberTemplate(groupId, adminToken, format);
      const blob = result;
      const filename = result.filename || `members_template.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setFileError(getFriendlyErrorMessage(err));
    } finally {
      setDownloadingFormat(null);
    }
  };

  // STEP 1: File Selection & Preview Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const selected = e.target.files?.[0];
    if (!selected) return;

    const ext = selected.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      setFileError('Please select a valid Excel (.xlsx) or CSV (.csv) file.');
      return;
    }

    if (selected.size > 5 * 1024 * 1024) {
      setFileError('File size exceeds the 5 MB limit. Please select a smaller file.');
      return;
    }

    setFile(selected);
  };

  const handleUploadPreview = async () => {
    if (!file) {
      setFileError('Please select a spreadsheet file first.');
      return;
    }

    setPreviewLoading(true);
    setFileError(null);

    try {
      const previewData = await previewMemberImport(groupId, adminToken, file);
      setPreview(previewData);

      // Initialize mapping choices from suggested_mapping
      const initialChoices: Record<number, ColumnChoice> = {};
      for (const col of previewData.columns) {
        const suggestion = previewData.suggested_mapping[String(col.index)];
        if (suggestion === 'name') {
          initialChoices[col.index] = { type: 'name' };
        } else if (suggestion && suggestion !== 'skip') {
          // Check if suggestion matches a field key
          const matchedField = fields.find((f) => f.key === suggestion);
          if (matchedField) {
            initialChoices[col.index] = { type: 'field', fieldKey: matchedField.key };
          } else {
            initialChoices[col.index] = { type: 'skip' };
          }
        } else {
          initialChoices[col.index] = { type: 'skip' };
        }
      }

      setColumnChoices(initialChoices);
      setStep(2);
    } catch (err) {
      setFileError(getFriendlyErrorMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  // STEP 2: Mapping Change Handlers
  const handleTargetChange = (colIndex: number, colHeader: string, targetValue: string) => {
    if (targetValue === 'name') {
      setColumnChoices((prev) => ({
        ...prev,
        [colIndex]: { type: 'name' },
      }));
    } else if (targetValue.startsWith('field:')) {
      const fieldKey = targetValue.replace('field:', '');
      setColumnChoices((prev) => ({
        ...prev,
        [colIndex]: { type: 'field', fieldKey },
      }));
    } else if (targetValue === 'new') {
      setColumnChoices((prev) => ({
        ...prev,
        [colIndex]: {
          type: 'new',
          newField: {
            name: colHeader,
            field_type: 'text',
            choices: [],
            is_required: false,
            default_value: null,
            is_identifier: false,
          },
        },
      }));
    } else {
      setColumnChoices((prev) => ({
        ...prev,
        [colIndex]: { type: 'skip' },
      }));
    }
  };

  const handleNewFieldUpdate = (
    colIndex: number,
    patch: Partial<import('../../lib/importMapping').NewFieldConfig>,
  ) => {
    setColumnChoices((prev) => {
      const current = prev[colIndex];
      if (current?.type !== 'new' || !current.newField) return prev;
      return {
        ...prev,
        [colIndex]: {
          ...current,
          newField: {
            ...current.newField,
            ...patch,
          },
        },
      };
    });
  };

  const mappingValidation = preview
    ? buildImportRequest(preview.columns, columnChoices, fields, canBeIdentifier)
    : { mapping: {}, problems: [] };

  // STEP 3: Dry Run Check
  const handleRunCheck = async () => {
    if (!file || !preview) return;
    if (mappingValidation.problems.length > 0) return;

    setCheckLoading(true);
    setCheckError(null);
    setCheckErrorDetails([]);
    setStep(3);

    try {
      const res = await importMembers(groupId, adminToken, {
        file,
        mapping: mappingValidation.mapping,
        new_fields: mappingValidation.newFields,
        dry_run: true,
        on_duplicate: onDuplicate,
      });
      setCheckResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setCheckError(err.message);
        if (err.details && err.details.length > 0) {
          setCheckErrorDetails(err.details);
        }
      } else {
        setCheckError(getFriendlyErrorMessage(err));
      }
    } finally {
      setCheckLoading(false);
    }
  };

  // STEP 4: Real Import
  const handleExecuteImport = async () => {
    if (!file || !preview) return;
    setImportLoading(true);
    setImportError(null);

    try {
      const res = await importMembers(groupId, adminToken, {
        file,
        mapping: mappingValidation.mapping,
        new_fields: mappingValidation.newFields,
        dry_run: false,
        on_duplicate: onDuplicate,
      });
      setImportResult(res);
      setStep(4);
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setImportError(err.message);
      } else {
        setImportError(getFriendlyErrorMessage(err));
      }
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Wizard Step Indicator */}
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4 text-xs font-semibold">
        <div className={`flex items-center gap-1.5 ${step >= 1 ? 'text-indigo-600' : 'text-neutral-400'}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-neutral-200 text-neutral-600'}`}>
            1
          </span>
          <span>1. File</span>
        </div>
        <span className="text-neutral-300">&rarr;</span>
        <div className={`flex items-center gap-1.5 ${step >= 2 ? 'text-indigo-600' : 'text-neutral-400'}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-neutral-200 text-neutral-600'}`}>
            2
          </span>
          <span>2. Map</span>
        </div>
        <span className="text-neutral-300">&rarr;</span>
        <div className={`flex items-center gap-1.5 ${step >= 3 ? 'text-indigo-600' : 'text-neutral-400'}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step >= 3 ? 'bg-indigo-600 text-white' : 'bg-neutral-200 text-neutral-600'}`}>
            3
          </span>
          <span>3. Check</span>
        </div>
        <span className="text-neutral-300">&rarr;</span>
        <div className={`flex items-center gap-1.5 ${step >= 4 ? 'text-indigo-600' : 'text-neutral-400'}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step >= 4 ? 'bg-indigo-600 text-white' : 'bg-neutral-200 text-neutral-600'}`}>
            4
          </span>
          <span>4. Import</span>
        </div>
      </div>

      {/* STEP 1: File Download & Selection */}
      {step === 1 && (
        <Card className="space-y-6">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-neutral-900">Upload Spreadsheet</h3>
            <p className="text-xs text-neutral-600">
              Download the template pre-populated with your group&apos;s custom fields, fill it in, and upload it.
            </p>
          </div>

          {/* Template Download Buttons */}
          <div className="flex flex-wrap gap-2.5 pt-1">
            <Button
              size="sm"
              variant="secondary"
              loading={downloadingFormat === 'xlsx'}
              onClick={() => handleDownloadTemplate('xlsx')}
            >
              Download template (Excel)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={downloadingFormat === 'csv'}
              onClick={() => handleDownloadTemplate('csv')}
            >
              Download template (CSV)
            </Button>
          </div>

          {fileError && <Banner type="error">{fileError}</Banner>}

          {/* File Picker */}
          <div className="space-y-2 pt-2 border-t border-neutral-100">
            <label htmlFor="spreadsheet-file-input" className="block text-xs font-semibold text-neutral-700">
              Select Excel (.xlsx) or CSV (.csv) file (Max 5 MB)
            </label>
            <input
              id="spreadsheet-file-input"
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-neutral-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
            />
            {file && (
              <p className="text-xs text-neutral-500">
                Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <div className="pt-2">
            <Button
              variant="primary"
              disabled={!file || previewLoading}
              loading={previewLoading}
              onClick={handleUploadPreview}
            >
              Continue to Mapping
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 2: Column Mapping */}
      {step === 2 && preview && (
        <Card className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-neutral-900">Map Columns</h3>
              <p className="text-xs text-neutral-500">
                Found {preview.total_rows} rows in {preview.filename}. Match each spreadsheet column to a member field.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setStep(1)}>
              &larr; Back
            </Button>
          </div>

          {mappingValidation.problems.length > 0 && (
            <Banner type="warning">
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                {mappingValidation.problems.map((prob, idx) => (
                  <li key={idx}>{prob}</li>
                ))}
              </ul>
            </Banner>
          )}

          {/* Mapping Table */}
          <div className="overflow-x-auto border border-neutral-200 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Column Header</th>
                  <th className="py-2.5 px-3">Sample Values</th>
                  <th className="py-2.5 px-3 min-w-[220px]">Map To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {preview.columns.map((col) => {
                  const choice = columnChoices[col.index] || { type: 'skip' };
                  const sampleVals = preview.sample_rows
                    .slice(0, 3)
                    .map((r) => r[col.index])
                    .filter((v) => v !== undefined && v !== '');

                  let selectValue = 'skip';
                  if (choice.type === 'name') selectValue = 'name';
                  else if (choice.type === 'field') selectValue = `field:${choice.fieldKey}`;
                  else if (choice.type === 'new') selectValue = 'new';

                  return (
                    <React.Fragment key={col.index}>
                      <tr className="hover:bg-neutral-50/50">
                        <td className="py-2.5 px-3 font-semibold text-neutral-900">
                          {col.header}
                        </td>
                        <td className="py-2.5 px-3 text-neutral-500 font-mono text-[11px]">
                          {sampleVals.length > 0 ? sampleVals.join(' | ') : '(empty)'}
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            value={selectValue}
                            onChange={(e) =>
                              handleTargetChange(col.index, col.header, e.target.value)
                            }
                            className="w-full px-2.5 py-1.5 text-xs border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                          >
                            <option value="name">Name (member display name)</option>
                            {fields.map((f) => (
                              <option key={f.id} value={`field:${f.key}`}>
                                {f.name} {f.is_identifier ? '(Identifier)' : ''}
                              </option>
                            ))}
                            <option value="skip">Skip column</option>
                            <option value="new">+ Create a new field from this column</option>
                          </select>
                        </td>
                      </tr>

                      {/* New Field Form Row */}
                      {choice.type === 'new' && choice.newField && (
                        <tr className="bg-indigo-50/30 border-b border-indigo-100">
                          <td colSpan={3} className="p-3">
                            <div className="bg-white p-3 rounded-lg border border-indigo-200 space-y-3">
                              <span className="text-xs font-bold text-indigo-900 block">
                                Configure New Field for Column &quot;{col.header}&quot;
                              </span>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                <div>
                                  <label className="block font-semibold text-neutral-700 mb-0.5">
                                    Field Name *
                                  </label>
                                  <input
                                    type="text"
                                    value={choice.newField.name}
                                    onChange={(e) =>
                                      handleNewFieldUpdate(col.index, { name: e.target.value })
                                    }
                                    className="w-full px-2.5 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                                  />
                                </div>

                                <div>
                                  <label className="block font-semibold text-neutral-700 mb-0.5">
                                    Field Type
                                  </label>
                                  <select
                                    value={choice.newField.field_type}
                                    onChange={(e) =>
                                      handleNewFieldUpdate(col.index, {
                                        field_type: e.target.value as FieldType,
                                      })
                                    }
                                    className="w-full px-2.5 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                                  >
                                    <option value="text">Text</option>
                                    <option value="number">Number</option>
                                    <option value="choice">Choice</option>
                                    <option value="link">Link</option>
                                  </select>
                                </div>
                              </div>

                              {choice.newField.field_type === 'choice' && (
                                <div className="text-xs">
                                  <label className="block font-semibold text-neutral-700 mb-0.5">
                                    Choices (one per line, min 2) *
                                  </label>
                                  <textarea
                                    rows={2}
                                    placeholder="Option 1&#10;Option 2"
                                    value={(choice.newField.choices || []).join('\n')}
                                    onChange={(e) =>
                                      handleNewFieldUpdate(col.index, {
                                        choices: e.target.value
                                          .split('\n')
                                          .map((c) => c.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                    className="w-full px-2.5 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                                  />
                                </div>
                              )}

                              <div className="flex items-center gap-4 text-xs pt-1">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(choice.newField.is_required)}
                                    onChange={(e) =>
                                      handleNewFieldUpdate(col.index, {
                                        is_required: e.target.checked,
                                      })
                                    }
                                    className="rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                                  />
                                  <span>Required</span>
                                </label>

                                {canBeIdentifier && choice.newField.field_type === 'text' && (
                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(choice.newField.is_identifier)}
                                      onChange={(e) =>
                                        handleNewFieldUpdate(col.index, {
                                          is_identifier: e.target.checked,
                                        })
                                      }
                                      className="rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                                    />
                                    <span>Use as the identifier</span>
                                  </label>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Duplicate Strategy */}
          <div className="pt-2 border-t border-neutral-100 space-y-2">
            <span className="block text-xs font-semibold text-neutral-700">
              If a person already exists:
            </span>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="on-duplicate-choice"
                  value="reject"
                  checked={onDuplicate === 'reject'}
                  onChange={() => setOnDuplicate('reject')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>Stop and show errors</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="on-duplicate-choice"
                  value="skip"
                  checked={onDuplicate === 'skip'}
                  onChange={() => setOnDuplicate('skip')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>Skip them</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              disabled={mappingValidation.problems.length > 0 || checkLoading}
              loading={checkLoading}
              onClick={handleRunCheck}
            >
              Check file
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)} disabled={checkLoading}>
              Back
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 3: Dry Run Check Results */}
      {step === 3 && (
        <Card className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-neutral-900">Dry Run Check Results</h3>
            <Button size="sm" variant="ghost" onClick={() => setStep(2)}>
              &larr; Back to Mapping
            </Button>
          </div>

          {checkError && (
            <Banner type="error">
              <p className="font-semibold">{checkError}</p>
              {checkErrorDetails.length > 0 && (
                <div className="mt-2 text-xs max-h-48 overflow-y-auto">
                  <ul className="list-disc list-inside space-y-1">
                    {checkErrorDetails.slice(0, 100).map((d, idx) => (
                      <li key={idx}>
                        Row {d.row ?? '?'}, {d.field ?? 'General'}: {d.message}
                      </li>
                    ))}
                  </ul>
                  {checkErrorDetails.length > 100 && (
                    <p className="mt-1 font-semibold">
                      and {checkErrorDetails.length - 100} more errors...
                    </p>
                  )}
                </div>
              )}
            </Banner>
          )}

          {checkResult && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-900">
              <p className="text-sm font-semibold text-emerald-950">
                File checked successfully!
              </p>
              <p>
                <strong>{`${checkResult.rows_added} rows ready to import`}</strong>,{' '}
                {`${checkResult.rows_skipped} skipped.`}
              </p>
              {checkResult.fields_created && checkResult.fields_created.length > 0 && (
                <p>
                  New fields to create:{' '}
                  <strong>{checkResult.fields_created.join(', ')}</strong>
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              disabled={!checkResult || checkResult.rows_added === 0 || importLoading}
              loading={importLoading}
              onClick={handleExecuteImport}
            >
              Import {checkResult?.rows_added ?? 0} people
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)} disabled={importLoading}>
              Back to Mapping
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 4: Success Summary */}
      {step === 4 && importResult && (
        <Card className="space-y-6 text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div className="space-y-1">
            <h3 className="text-lg font-bold text-neutral-900">Import Complete</h3>
            <p className="text-sm text-neutral-600">
              Successfully imported <strong>{importResult.rows_added}</strong> members
              {importResult.rows_skipped > 0 && ` (${importResult.rows_skipped} skipped)`}.
            </p>
            {importResult.fields_created && importResult.fields_created.length > 0 && (
              <p className="text-xs text-neutral-500">
                Created fields: {importResult.fields_created.join(', ')}.
              </p>
            )}
          </div>

          <div>
            <Button variant="primary" onClick={onSwitchToMembers}>
              View Members
            </Button>
          </div>
        </Card>
      )}

      {importError && <Banner type="error">{importError}</Banner>}
    </div>
  );
};
