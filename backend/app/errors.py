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


class FieldNotFoundError(PollingAppError):
    """Raised when a requested group field does not exist."""

    pass


class PollValidationError(PollingAppError):
    """Raised when poll, field, or member creation input fails validation constraints."""

    def __init__(self, message: str, details: list[dict] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details


class InvalidTokenError(PollingAppError):
    """Raised when a provided token is missing, malformed, or invalid."""

    pass


class PermissionDeniedError(PollingAppError):
    """Raised when an operation is attempted on an entity outside the allowed group."""

    pass


class ClaimConflictError(PollingAppError):
    """Raised when attempting to claim a member that has already been claimed."""

    pass


class ClaimStateError(PollingAppError):
    """Raised when an action is invalid for the member's current claim state."""

    pass


class ClaimNotApprovedError(PollingAppError):
    """Raised when a member claim has not yet been approved."""

    pass


class RateLimitError(PollingAppError):
    """Raised when an operation has exceeded rate limits."""

    pass

