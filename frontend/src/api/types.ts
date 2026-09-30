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
