/**
 * API response and request type definitions matching the backend schemas.
 */

export interface JoinMember {
  id: string;
  display_name: string;
  taken: boolean;
  identifier_hint?: string | null;
}

export interface JoinGroupResponse {
  group_id: string;
  group_name: string;
  claim_mode?: 'list' | 'identifier';
  identifier_label?: string | null;
  allow_name_list?: boolean;
  members: JoinMember[];
}

export interface MemberLookupResponse {
  member_id: string;
  display_name: string | null;
  taken: boolean;
}

export interface ClaimRequest {
  member_id: string;
}

export interface ClaimResponse {
  member_id: string;
  member_token: string;
  status: 'approved' | 'pending';
}

export interface MeResponse {
  member_id: string;
  display_name: string;
  group_id: string;
  group_name: string;
  claim_status: 'approved' | 'pending' | 'unclaimed';
}

export interface ReleaseClaimResponse {
  status: string;
}


export interface MemberPollSummary {
  id: string;
  name: string;
  status: 'open' | 'closed';
  deadline: string | null;
}

export interface PollOption {
  id: string;
  label: string;
  position: number;
}

export type FieldType = 'text' | 'number' | 'choice' | 'link';

export interface PublicPollField {
  id?: string;
  key: string;
  name: string;
  field_type: FieldType;
  is_required: boolean;
  default_value: string | null;
  choices: string[] | null;
  position: number;
}

export interface PublicPollResponse {
  id: string;
  name: string;
  description_raw: string | null;
  status: 'open' | 'closed';
  allow_multiple: boolean;
  deadline: string | null;
  options: PollOption[];
  group_name: string;
  join_code: string;
  poll_fields?: PublicPollField[];
}

export interface VoteRequest {
  option_id: string;
}

export interface VoteResponse {
  selected_option_ids: string[];
}

export interface MemberPollHistoryItem {
  option_id: string;
  option_label: string;
  first_selected_at: string;
  last_selected_at: string;
  is_selected: boolean;
}

export interface MemberPollMeResponse {
  selected_option_ids: string[];
  history: MemberPollHistoryItem[];
  answers?: Record<string, string | number | null>;
  answers_updated_at?: string | null;
}

export interface PollAnswersResponse {
  answers: Record<string, string | number | null>;
  answers_updated_at: string | null;
}

export interface ApiErrorRowDetail {
  row?: number;
  field?: string;
  message: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: ApiErrorRowDetail[];
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetail;
}

export interface StoredMemberIdentity {
  memberToken: string;
  memberId: string;
  displayName: string;
}

// Creator / Admin Types (Part 3B & R4)

export interface GroupField {
  id: string;
  key: string;
  name: string;
  field_type: FieldType;
  is_required: boolean;
  default_value: string | null;
  choices: string[] | null;
  is_identifier: boolean;
  position: number;
}

export interface CreateFieldPayload {
  name: string;
  field_type: FieldType;
  is_required?: boolean;
  default_value?: string | null;
  choices?: string[] | null;
}

export interface UpdateFieldPayload {
  name?: string;
  is_required?: boolean;
  default_value?: string | null;
  choices?: string[] | null;
  is_identifier?: boolean;
}

export interface MemberInput {
  display_name: string;
  values?: Record<string, string | number | null>;
}

export interface CreateGroupResponse {
  group_id: string;
  name: string;
  join_code: string;
  admin_token: string;
}

export interface GroupMember {
  id: string;
  display_name: string;
  is_active: boolean;
  claim_status: 'unclaimed' | 'pending' | 'approved';
  values?: Record<string, string | number | null>;
  identifier?: string | null;
}

export interface AdminGroupDetailResponse {
  id: string;
  name: string;
  join_code: string;
  require_claim_approval: boolean;
  allow_name_list?: boolean;
  fields: GroupField[];
  members: GroupMember[];
}

export interface ColumnPreview {
  index: number;
  header: string;
}

export interface ImportPreviewResponse {
  filename: string;
  sheet: string | null;
  columns: ColumnPreview[];
  total_rows: number;
  sample_rows: string[][];
  suggested_mapping: Record<string, string>;
}

export interface ImportNewField {
  column: number;
  name: string;
  field_type: FieldType;
  choices?: string[];
  is_required?: boolean;
  default_value?: string | null;
  is_identifier?: boolean;
}

export interface ImportMembersOptions {
  file: File;
  mapping: Record<string, string>;
  new_fields?: ImportNewField[];
  dry_run: boolean;
  on_duplicate: 'reject' | 'skip';
}

export interface ImportResultResponse {
  dry_run: boolean;
  rows_total: number;
  rows_added: number;
  rows_skipped: number;
  fields_created: string[];
  errors: ApiErrorRowDetail[];
}

export interface AdminPollListItem {
  id: string;
  name: string;
  status: 'open' | 'closed';
  deadline: string | null;
  created_at: string;
}

export type PollOptionRole = 'target' | 'in_progress' | 'excused' | 'not_yet';
export type CompletionTimeMode = 'first' | 'last';

export interface CreatePollOptionPayload {
  label: string;
  role: PollOptionRole;
}

export interface PollOnlyFieldPayload {
  name: string;
  field_type: FieldType;
  is_required?: boolean;
  default_value?: string | null;
  choices?: string[] | null;
}

export interface CreatePollPayload {
  name: string;
  description_raw?: string | null;
  allow_multiple: boolean;
  options: CreatePollOptionPayload[];
  deadline?: string | null;
  completion_time_mode: CompletionTimeMode;
  included_field_ids?: string[];
  poll_fields?: PollOnlyFieldPayload[];
}

export interface CreatePollResponse {
  id: string;
  name: string;
  description_raw: string | null;
  status: 'open' | 'closed';
  allow_multiple: boolean;
  deadline: string | null;
  completion_time_mode: CompletionTimeMode;
  created_at: string;
  options: Array<{
    id: string;
    label: string;
    role: PollOptionRole;
    position: number;
  }>;
  included_fields?: Array<{
    id: string;
    key: string;
    name: string;
    field_type: FieldType;
  }>;
  poll_fields?: Array<{
    id: string;
    key: string;
    name: string;
    field_type: FieldType;
    is_required: boolean;
    default_value: string | null;
    choices: string[] | null;
    position: number;
  }>;
}

export interface AdminPollStatusResponse {
  poll: {
    id: string;
    name: string;
    status: 'open' | 'closed';
    allow_multiple: boolean;
    deadline: string | null;
    completion_time_mode: CompletionTimeMode;
  };
  counts: {
    total_active: number;
    at_target: number;
    excused: number;
    behind_target: number;
    not_voted: number;
  };
  all_reached: boolean;
  at_target: Array<{
    member_id: string;
    display_name: string;
    identifier?: string | null;
    completed_at: string | null;
    late: boolean;
  }>;
  excused: Array<{
    member_id: string;
    display_name: string;
    identifier?: string | null;
  }>;
  behind_target: Array<{
    member_id: string;
    display_name: string;
    identifier?: string | null;
  }>;
  not_voted: Array<{
    member_id: string;
    display_name: string;
    identifier?: string | null;
  }>;
}

export interface AdminPollHistoryResponseItem {
  member_id: string;
  display_name: string;
  identifier?: string | null;
  history: Array<{
    option_id: string;
    option_label: string;
    first_selected_at: string;
    last_selected_at: string;
    is_selected: boolean;
  }>;
}

export type AdminPollHistoryResponse = AdminPollHistoryResponseItem[];

export interface PollResultColumn {
  source: 'group' | 'poll';
  key: string;
  name: string;
  field_type: FieldType;
  is_identifier: boolean;
}

export interface PollResultRow {
  member_id: string;
  display_name: string;
  identifier: string | null;
  status: 'at_target' | 'behind_target' | 'excused' | 'not_voted';
  selected_options: string[];
  late: boolean | null;
  completed_at: string | null;
  group_values: Record<string, string | number | null>;
  answers: Record<string, string | number | null>;
  answers_updated_at: string | null;
  answers_complete: boolean;
}

export interface PollResultsResponse {
  poll: {
    id: string;
    name: string;
    status: 'open' | 'closed';
    deadline: string | null;
    allow_multiple: boolean;
  };
  columns: PollResultColumn[];
  rows: PollResultRow[];
}

export interface AdminGroupStorageData {
  adminToken: string;
  groupName: string;
}

