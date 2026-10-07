import type { FieldType, GroupField, ImportNewField } from '../api/types';

export type MappingTargetType = 'name' | 'field' | 'skip' | 'new';

export interface NewFieldConfig {
  name: string;
  field_type: FieldType;
  choices?: string[];
  is_required?: boolean;
  default_value?: string | null;
  is_identifier?: boolean;
}

export interface ColumnChoice {
  type: MappingTargetType;
  fieldKey?: string;
  newField?: NewFieldConfig;
}

export interface BuildImportResult {
  mapping: Record<string, string>;
  newFields?: ImportNewField[];
  problems: string[];
}

export function buildImportRequest(
  columns: Array<{ index: number; header: string }>,
  choices: Record<number, ColumnChoice>,
  existingFields: GroupField[],
  canBeIdentifier = false,
): BuildImportResult {
  const problems: string[] = [];
  const mapping: Record<string, string> = {};
  const newFields: ImportNewField[] = [];

  let nameColumnCount = 0;
  const mappedFieldKeys = new Set<string>();
  const seenNewFieldNames = new Set<string>();
  const existingFieldNamesLower = new Set(existingFields.map((f) => f.name.toLowerCase()));

  for (const col of columns) {
    const choice = choices[col.index] || { type: 'skip' };

    if (choice.type === 'name') {
      nameColumnCount++;
      mapping[String(col.index)] = 'name';
    } else if (choice.type === 'field') {
      const key = choice.fieldKey || '';
      if (!key) {
        problems.push(`Column "${col.header}" is mapped to a field but no field was selected.`);
      } else {
        if (mappedFieldKeys.has(key)) {
          const fieldObj = existingFields.find((f) => f.key === key);
          const fieldName = fieldObj ? fieldObj.name : key;
          problems.push(`Multiple columns are mapped to the same field: "${fieldName}".`);
        }
        mappedFieldKeys.add(key);
        mapping[String(col.index)] = key;
      }
    } else if (choice.type === 'new') {
      // Columns turned into new fields must be "skip" in mapping
      mapping[String(col.index)] = 'skip';

      const nf = choice.newField;
      if (!nf || !nf.name || !nf.name.trim()) {
        problems.push(`New field for column "${col.header}" must have a name.`);
      } else {
        const trimmedName = nf.name.trim();
        const lowerName = trimmedName.toLowerCase();

        if (seenNewFieldNames.has(lowerName)) {
          problems.push(`Duplicate new field name: "${trimmedName}".`);
        }
        seenNewFieldNames.add(lowerName);

        if (existingFieldNamesLower.has(lowerName)) {
          problems.push(`Field "${trimmedName}" already exists in the group.`);
        }

        if (nf.field_type === 'choice') {
          const choicesList = nf.choices || [];
          if (choicesList.length < 2) {
            problems.push(`Choice field "${trimmedName}" must have at least 2 choices.`);
          }
        }

        if (nf.is_identifier && !canBeIdentifier) {
          problems.push(
            `Cannot set "${trimmedName}" as identifier because the group already has members or an identifier field.`,
          );
        }

        newFields.push({
          column: col.index,
          name: trimmedName,
          field_type: nf.field_type,
          choices: nf.field_type === 'choice' ? nf.choices : undefined,
          is_required: nf.is_required,
          default_value: nf.default_value?.trim() || null,
          is_identifier: nf.is_identifier,
        });
      }
    } else {
      // 'skip'
      mapping[String(col.index)] = 'skip';
    }
  }

  if (nameColumnCount === 0) {
    problems.push('Exactly one column must be mapped to Name.');
  } else if (nameColumnCount > 1) {
    problems.push('Only one column can be mapped to Name.');
  }

  return {
    mapping,
    newFields: newFields.length > 0 ? newFields : undefined,
    problems,
  };
}
