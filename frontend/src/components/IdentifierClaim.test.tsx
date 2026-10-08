import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IdentifierClaim } from './IdentifierClaim';
import * as endpoints from '../api/endpoints';
import { ApiError } from '../api/client';
import { _clearMemoryStore, saveMemberIdentity } from '../lib/storage';

vi.mock('../api/endpoints', () => ({
  lookupIdentifier: vi.fn(),
}));

describe('IdentifierClaim', () => {
  const defaultProps = {
    joinCode: 'code123',
    claimMode: 'identifier' as const,
    identifierLabel: 'Register No',
    allowNameList: false,
    members: [],
    onClaim: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    _clearMemoryStore();
    vi.clearAllMocks();
  });

  it('found then confirm claims with the right member id and name', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.lookupIdentifier).mockResolvedValue({
      member_id: 'mem-99',
      display_name: 'Dr. Jane Watson',
      taken: false,
    });

    render(<IdentifierClaim {...defaultProps} />);

    expect(screen.getByLabelText(/Register No/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'REG001');

    const findBtn = screen.getByRole('button', { name: /Find me/i });
    expect(findBtn).not.toBeDisabled();
    await user.click(findBtn);

    expect(endpoints.lookupIdentifier).toHaveBeenCalledWith('code123', 'REG001');

    await waitFor(() => {
      expect(screen.getByText(/Is this you\?/i)).toBeInTheDocument();
      expect(screen.getByText('Dr. Jane Watson')).toBeInTheDocument();
    });

    const yesBtn = screen.getByRole('button', { name: /Yes, that's me/i });
    await user.click(yesBtn);

    expect(defaultProps.onClaim).toHaveBeenCalledWith('mem-99', 'Dr. Jane Watson');
  });

  it('"No, try again" resets the confirmation box and allows searching again', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.lookupIdentifier).mockResolvedValue({
      member_id: 'mem-99',
      display_name: 'Dr. Jane Watson',
      taken: false,
    });

    render(<IdentifierClaim {...defaultProps} />);

    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'REG001');
    await user.click(screen.getByRole('button', { name: /Find me/i }));

    await waitFor(() => {
      expect(screen.getByText('Dr. Jane Watson')).toBeInTheDocument();
    });

    const noBtn = screen.getByRole('button', { name: /No, try again/i });
    await user.click(noBtn);

    expect(screen.queryByText(/Is this you\?/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Register No/i)).toBeInTheDocument();
  });

  it('clears confirmation box if user edits the input text', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.lookupIdentifier).mockResolvedValue({
      member_id: 'mem-99',
      display_name: 'Dr. Jane Watson',
      taken: false,
    });

    render(<IdentifierClaim {...defaultProps} />);

    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'REG001');
    await user.click(screen.getByRole('button', { name: /Find me/i }));

    await waitFor(() => {
      expect(screen.getByText('Dr. Jane Watson')).toBeInTheDocument();
    });

    // Edit input
    await user.type(input, '2');
    expect(screen.queryByText(/Is this you\?/i)).not.toBeInTheDocument();
  });

  it('taken shows the already claimed message and does not show member name', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.lookupIdentifier).mockResolvedValue({
      member_id: 'mem-88',
      display_name: null,
      taken: true,
    });

    render(<IdentifierClaim {...defaultProps} />);

    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'REG002');
    await user.click(screen.getByRole('button', { name: /Find me/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /That Register No is already claimed\. If it is you on a new phone, ask the group creator to reset it\./i,
        ),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText(/Is this you\?/i)).not.toBeInTheDocument();
  });

  it('handles 404 with friendly not found message', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.lookupIdentifier).mockRejectedValue(
      new ApiError(404, 'not_found', 'No member matches that identifier.'),
    );

    render(<IdentifierClaim {...defaultProps} />);

    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'UNKNOWN');
    await user.click(screen.getByRole('button', { name: /Find me/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/We could not find that Register No\. Check it and try again\./i),
      ).toBeInTheDocument();
    });
  });

  it('handles 429 rate limit with wait message', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.lookupIdentifier).mockRejectedValue(
      new ApiError(429, 'rate_limited', 'Too many attempts.'),
    );

    render(<IdentifierClaim {...defaultProps} />);

    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'SPAM123');
    await user.click(screen.getByRole('button', { name: /Find me/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Too many attempts\. Please wait a minute and try again\./i),
      ).toBeInTheDocument();
    });
  });

  it('the "Find me" button is disabled while loading and when input is empty', async () => {
    const user = userEvent.setup();
    let resolveLookup: (val: any) => void;
    vi.mocked(endpoints.lookupIdentifier).mockReturnValue(
      new Promise((res) => {
        resolveLookup = res;
      }),
    );

    render(<IdentifierClaim {...defaultProps} />);

    const findBtn = screen.getByRole('button', { name: /Find me/i });
    expect(findBtn).toBeDisabled();

    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'REG777');
    expect(findBtn).not.toBeDisabled();

    await user.click(findBtn);
    expect(findBtn).toBeDisabled();

    resolveLookup!({
      member_id: 'mem-1',
      display_name: 'Test',
      taken: false,
    });

    await waitFor(() => {
      expect(screen.getByText(/Is this you\?/i)).toBeInTheDocument();
    });
  });

  it('the stored-identity protection prevents a second claim if browser was already signed in', async () => {
    const user = userEvent.setup();
    vi.mocked(endpoints.lookupIdentifier).mockResolvedValue({
      member_id: 'mem-99',
      display_name: 'Dr. Jane Watson',
      taken: false,
    });

    render(<IdentifierClaim {...defaultProps} />);

    const input = screen.getByLabelText(/Register No/i);
    await user.type(input, 'REG001');
    await user.click(screen.getByRole('button', { name: /Find me/i }));

    await waitFor(() => {
      expect(screen.getByText(/Is this you\?/i)).toBeInTheDocument();
    });

    // Simulate another tab signing in before user confirms
    saveMemberIdentity('code123', {
      memberToken: 'tab2-token',
      memberId: 'mem-11',
      displayName: 'Existing Signin',
    });

    const yesBtn = screen.getByRole('button', { name: /Yes, that's me/i });
    await user.click(yesBtn);

    expect(defaultProps.onClaim).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This browser is already signed in as Existing Signin\./i),
    ).toBeInTheDocument();
  });
});
