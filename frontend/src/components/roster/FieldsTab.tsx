import React, { useState } from 'react';
import type { CreateFieldPayload, FieldType, GroupField, GroupMember, UpdateFieldPayload } from '../../api/types';
import { createField, deleteField, updateField } from '../../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../../api/client';
import { Button } from '../Button';
import { Card } from '../Card';
import { Banner } from '../Banner';

interface FieldsTabProps {
  groupId: string;
  adminToken: string;
  fields: GroupField[];
  members: GroupMember[];
  onRefresh: () => Promise<void>;
}

export const FieldsTab: React.FC<FieldsTabProps> = ({
  groupId,
  adminToken,
  fields,
  members,
  onRefresh,
}) => {
  // Add Field State
  const [isAdding, setIsAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<FieldType>('text');
  const [addRequired, setAddRequired] = useState(false);
  const [addDefault, setAddDefault] = useState('');
  const [addChoicesText, setAddChoicesText] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit Field State
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRequired, setEditRequired] = useState(false);
  const [editDefault, setEditDefault] = useState('');
  const [editChoicesText, setEditChoicesText] = useState('');
  const [editIsIdentifier, setEditIsIdentifier] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editOffendingMembers, setEditOffendingMembers] = useState<string[]>([]);
  const [editMoreOffendersCount, setEditMoreOffendersCount] = useState(0);

  // Delete State
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sort fields by position order
  const sortedFields = [...fields].sort((a, b) => a.position - b.position);

  const resetAddForm = () => {
    setIsAdding(false);
    setAddName('');
    setAddType('text');
    setAddRequired(false);
    setAddDefault('');
    setAddChoicesText('');
    setAddError(null);
  };

  const handleStartEdit = (field: GroupField) => {
    setEditingFieldId(field.id);
    setEditName(field.name);
    setEditRequired(field.is_required);
    setEditDefault(field.default_value ?? '');
    setEditChoicesText(field.choices ? field.choices.join('\n') : '');
    setEditIsIdentifier(field.is_identifier);
    setEditError(null);
    setEditOffendingMembers([]);
    setEditMoreOffendersCount(0);
  };

  const handleCancelEdit = () => {
    setEditingFieldId(null);
    setEditError(null);
    setEditOffendingMembers([]);
    setEditMoreOffendersCount(0);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) {
      setAddError('Field name is required.');
      return;
    }

    setAddLoading(true);
    setAddError(null);

    let choices: string[] | null = null;
    if (addType === 'choice') {
      choices = addChoicesText
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean);
      if (choices.length < 2) {
        setAddError('Choice fields must have at least 2 choices.');
        setAddLoading(false);
        return;
      }
    }

    const payload: CreateFieldPayload = {
      name: addName.trim(),
      field_type: addType,
      is_required: addRequired,
      default_value: addDefault.trim() ? addDefault.trim() : null,
      choices,
    };

    try {
      await createField(groupId, adminToken, payload);
      resetAddForm();
      await onRefresh();
    } catch (err) {
      setAddError(getFriendlyErrorMessage(err));
    } finally {
      setAddLoading(false);
    }
  };

  const handleEditSubmit = async (field: GroupField) => {
    if (!editName.trim()) {
      setEditError('Field name is required.');
      return;
    }

    setEditLoading(true);
    setEditError(null);
    setEditOffendingMembers([]);
    setEditMoreOffendersCount(0);

    let choices: string[] | null = null;
    if (field.field_type === 'choice') {
      choices = editChoicesText
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean);
      if (choices.length < 2) {
        setEditError('Choice fields must have at least 2 choices.');
        setEditLoading(false);
        return;
      }
    }

    const payload: UpdateFieldPayload = {
      name: editName.trim(),
      is_required: editRequired,
      default_value: editDefault.trim() === '' ? '' : editDefault.trim(),
      choices: field.field_type === 'choice' ? choices : undefined,
    };

    if (field.field_type === 'text') {
      payload.is_identifier = editIsIdentifier;
    }

    try {
      await updateField(groupId, field.id, adminToken, payload);
      setEditingFieldId(null);
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setEditError(err.message);
        if (err.details && err.details.length > 0) {
          const names = err.details
            .map((d) => d.message || d.field || '')
            .filter(Boolean);
          if (names.length > 10) {
            setEditOffendingMembers(names.slice(0, 10));
            setEditMoreOffendersCount(names.length - 10);
          } else {
            setEditOffendingMembers(names);
          }
        }
      } else {
        setEditError(getFriendlyErrorMessage(err));
      }
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (field: GroupField) => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteField(groupId, field.id, adminToken);
      setDeletingFieldId(null);
      await onRefresh();
    } catch (err) {
      setDeleteError(getFriendlyErrorMessage(err));
    } finally {
      setDeleteLoading(false);
    }
  };

  const countMembersWithValue = (fieldKey: string) => {
    return members.filter(
      (m) =>
        m.values &&
        m.values[fieldKey] !== undefined &&
        m.values[fieldKey] !== null &&
        m.values[fieldKey] !== '',
    ).length;
  };

  const parsedAddChoices = addChoicesText
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

  const parsedEditChoices = editChoicesText
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Identifier hint line */}
      <div className="p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-xl text-xs text-indigo-900 leading-relaxed">
        <strong>Identifier Hint:</strong> Pick one field that is different for every person, like a
        register number. It is used to find people and tell apart members who share a name.
      </div>

      {deleteError && <Banner type="error">{deleteError}</Banner>}

      {/* Field List & Add Button Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-neutral-900">Group Fields ({fields.length})</h2>
        {!isAdding && (
          <Button size="sm" variant="primary" onClick={() => setIsAdding(true)}>
            Add field
          </Button>
        )}
      </div>

      {/* Add Field Form */}
      {isAdding && (
        <Card className="space-y-4 border-2 border-indigo-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-900">Add New Field</h3>
            <button
              type="button"
              onClick={resetAddForm}
              className="text-neutral-400 hover:text-neutral-600 text-sm font-medium"
            >
              Cancel
            </button>
          </div>

          {addError && <Banner type="error">{addError}</Banner>}

          <form onSubmit={handleAddSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="add-field-name" className="block text-xs font-semibold text-neutral-700 mb-1">
                Field Name *
              </label>
              <input
                id="add-field-name"
                type="text"
                required
                placeholder="e.g. Register No, Department"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            <div>
              <label htmlFor="add-field-type" className="block text-xs font-semibold text-neutral-700 mb-1">
                Field Type
              </label>
              <select
                id="add-field-type"
                value={addType}
                onChange={(e) => {
                  setAddType(e.target.value as FieldType);
                  setAddDefault('');
                }}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
              >
                <option value="text">Text (short or long text)</option>
                <option value="number">Number</option>
                <option value="choice">Choice (pick from list)</option>
                <option value="link">Link (web address)</option>
              </select>
            </div>

            {addType === 'choice' && (
              <div>
                <label htmlFor="add-field-choices" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Choices (one per line, minimum 2) *
                </label>
                <textarea
                  id="add-field-choices"
                  rows={3}
                  placeholder="Option 1&#10;Option 2&#10;Option 3"
                  value={addChoicesText}
                  onChange={(e) => setAddChoicesText(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
            )}

            <div>
              <label htmlFor="add-field-default" className="block text-xs font-semibold text-neutral-700 mb-1">
                Default Value (optional)
              </label>
              {addType === 'choice' ? (
                <select
                  id="add-field-default"
                  value={addDefault}
                  onChange={(e) => setAddDefault(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                >
                  <option value="">No default</option>
                  {parsedAddChoices.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="add-field-default"
                  type={addType === 'number' ? 'number' : 'text'}
                  placeholder={addType === 'link' ? 'https://...' : 'Default value'}
                  value={addDefault}
                  onChange={(e) => setAddDefault(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              )}
            </div>

            <div className="pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={addRequired}
                  onChange={(e) => setAddRequired(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Required field
                </span>
              </label>
              <p className="text-xs text-neutral-500 ml-6">
                If checked and members already exist, a default value is required by the server.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="primary" loading={addLoading}>
                Save Field
              </Button>
              <Button type="button" variant="ghost" onClick={resetAddForm} disabled={addLoading}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Field List */}
      <div className="space-y-3">
        {sortedFields.length === 0 ? (
          <Card className="text-center py-8">
            <p className="text-sm text-neutral-500">
              No custom fields defined yet. Add fields to store attributes like Register No or Department.
            </p>
          </Card>
        ) : (
          sortedFields.map((field) => {
            const isEditing = editingFieldId === field.id;
            const isDeleting = deletingFieldId === field.id;
            const valCount = countMembersWithValue(field.key);

            if (isEditing) {
              return (
                <Card key={field.id} className="space-y-4 border border-indigo-300 bg-indigo-50/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                      Edit Field: {field.name}
                    </span>
                    <span className="text-xs font-mono bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded">
                      Type: {field.field_type} (not editable)
                    </span>
                  </div>

                  {editError && (
                    <Banner type="error">
                      <p>{editError}</p>
                      {editOffendingMembers.length > 0 && (
                        <div className="mt-2 text-xs">
                          <p className="font-semibold">Offending members:</p>
                          <ul className="list-disc list-inside mt-1 space-y-0.5">
                            {editOffendingMembers.map((m, idx) => (
                              <li key={idx}>{m}</li>
                            ))}
                            {editMoreOffendersCount > 0 && (
                              <li>and {editMoreOffendersCount} more</li>
                            )}
                          </ul>
                        </div>
                      )}
                    </Banner>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Field Name *
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                      />
                    </div>

                    {field.field_type === 'choice' && (
                      <div>
                        <label className="block text-xs font-semibold text-neutral-700 mb-1">
                          Choices (one per line, replaces list) *
                        </label>
                        <textarea
                          rows={3}
                          value={editChoicesText}
                          onChange={(e) => setEditChoicesText(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                        />
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-neutral-700">
                          Default Value
                        </label>
                        {editDefault && (
                          <button
                            type="button"
                            onClick={() => setEditDefault('')}
                            className="text-xs text-indigo-600 hover:text-indigo-800 underline"
                          >
                            Clear default
                          </button>
                        )}
                      </div>
                      {field.field_type === 'choice' ? (
                        <select
                          value={editDefault}
                          onChange={(e) => setEditDefault(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                        >
                          <option value="">No default</option>
                          {parsedEditChoices.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.field_type === 'number' ? 'number' : 'text'}
                          value={editDefault}
                          placeholder="No default (empty to clear)"
                          onChange={(e) => setEditDefault(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                        />
                      )}
                    </div>

                    <div>
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={editRequired}
                          onChange={(e) => setEditRequired(e.target.checked)}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                        />
                        <span className="text-sm font-medium text-neutral-900">
                          Required field
                        </span>
                      </label>
                    </div>

                    {field.field_type === 'text' && (
                      <div className="pt-1">
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={editIsIdentifier}
                            onChange={(e) => setEditIsIdentifier(e.target.checked)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                          />
                          <span className="text-sm font-medium text-neutral-900">
                            Use as identifier (must be unique for every member)
                          </span>
                        </label>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="primary"
                        loading={editLoading}
                        onClick={() => handleEditSubmit(field)}
                      >
                        Save Changes
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancelEdit}
                        disabled={editLoading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            }

            return (
              <Card key={field.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold text-neutral-900">{field.name}</h3>
                      <span className="text-xs font-mono uppercase bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded">
                        {field.field_type}
                      </span>
                      {field.is_required && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          Required
                        </span>
                      )}
                      {field.is_identifier && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Identifier
                        </span>
                      )}
                    </div>

                    {field.default_value && (
                      <p className="text-xs text-neutral-500">
                        Default: <code className="font-mono bg-neutral-100 px-1 py-0.5 rounded text-neutral-700">{field.default_value}</code>
                      </p>
                    )}

                    {field.choices && field.choices.length > 0 && (
                      <p className="text-xs text-neutral-500">
                        Choices: {field.choices.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleStartEdit(field)}
                    >
                      Edit
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={field.is_identifier}
                      title={field.is_identifier ? 'Identifier field cannot be deleted. Unmark it first.' : undefined}
                      onClick={() => setDeletingFieldId(field.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Delete Confirmation Box */}
                {isDeleting && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                    <p>
                      <strong>Delete field &quot;{field.name}&quot;?</strong>{' '}
                      {valCount === 1
                        ? '1 member currently has a value for this field.'
                        : `${valCount} members currently have a value for this field.`}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deleteLoading}
                        onClick={() => handleDelete(field)}
                      >
                        Confirm Delete
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeletingFieldId(null)}
                        disabled={deleteLoading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
