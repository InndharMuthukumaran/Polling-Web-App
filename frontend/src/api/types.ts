/**
 * API response and request type definitions matching the backend schemas.
 */

export interface JoinMember {
  id: string;
  display_name: string;
  taken: boolean;
}

export interface JoinGroupResponse {
  group_id: string;
  group_name: string;
  members: JoinMember[];
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
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetail;
}

export interface StoredMemberIdentity {
  memberToken: string;
  memberId: string;
  displayName: string;
}

// Creator / Admin Types (Part 3B)

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
}

export interface AdminGroupDetailResponse {
  id: string;
  name: string;
  join_code: string;
  require_claim_approval: boolean;
  members: GroupMember[];
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

export interface CreatePollPayload {
  name: string;
  description_raw?: string | null;
  allow_multiple: boolean;
  options: CreatePollOptionPayload[];
  deadline?: string | null;
  completion_time_mode: CompletionTimeMode;
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
    completed_at: string | null;
    late: boolean;
  }>;
  excused: Array<{
    member_id: string;
    display_name: string;
  }>;
  behind_target: Array<{
    member_id: string;
    display_name: string;
  }>;
  not_voted: Array<{
    member_id: string;
    display_name: string;
  }>;
}

export interface AdminPollHistoryResponseItem {
  member_id: string;
  display_name: string;
  history: Array<{
    option_id: string;
    option_label: string;
    first_selected_at: string;
    last_selected_at: string;
    is_selected: boolean;
  }>;
}

export type AdminPollHistoryResponse = AdminPollHistoryResponseItem[];

export interface AdminGroupStorageData {
  adminToken: string;
  groupName: string;
}

