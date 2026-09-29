"""Custom domain exceptions for the polling application."""


class PollingAppError(Exception):
    """Base exception for all polling application errors."""

    pass


class GroupNotFoundError(PollingAppError):
    """Raised when a requested group does not exist."""

    pass


class MemberNotFoundError(PollingAppError):
    """Raised when a requested member does not exist."""

    pass


class PollNotFoundError(PollingAppError):
    """Raised when a requested poll does not exist."""

    pass


class OptionNotFoundError(PollingAppError):
    """Raised when a requested poll option does not exist."""

    pass


class PollClosedError(PollingAppError):
    """Raised when attempting an operation on a closed poll that requires it to be open."""

    pass


class MemberInactiveError(PollingAppError):
    """Raised when an inactive member attempts to participate in a poll."""

    pass


class MemberGroupMismatchError(PollingAppError):
    """Raised when a member does not belong to the group associated with the poll."""

    pass


class OptionPollMismatchError(PollingAppError):
    """Raised when an option does not belong to the specified poll."""

    pass


class PollValidationError(PollingAppError):
    """Raised when poll creation input fails validation constraints."""

    pass
