"""API exception handlers and error response mappings."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import (
    ClaimConflictError,
    ClaimNotApprovedError,
    ClaimStateError,
    GroupNotFoundError,
    InvalidTokenError,
    MemberGroupMismatchError,
    MemberInactiveError,
    MemberNotFoundError,
    OptionNotFoundError,
    OptionPollMismatchError,
    PermissionDeniedError,
    PollClosedError,
    PollingAppError,
    PollNotFoundError,
    PollValidationError,
)


class MissingTokenError(Exception):
    """Raised when a required authentication header is missing or empty."""

    def __init__(self, message: str = "Authentication token header is missing"):
        super().__init__(message)
        self.message = message


def create_error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """Format and return a standardized JSON error response."""
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def register_error_handlers(app: FastAPI) -> None:
    """Register all custom domain and database error handlers on the FastAPI app."""

    @app.exception_handler(MissingTokenError)
    async def missing_token_handler(request: Request, exc: MissingTokenError):
        return create_error_response(401, "missing_token", exc.message)

    @app.exception_handler(InvalidTokenError)
    async def invalid_token_handler(request: Request, exc: InvalidTokenError):
        return create_error_response(401, "invalid_token", str(exc))

    @app.exception_handler(PermissionDeniedError)
    async def permission_denied_handler(request: Request, exc: PermissionDeniedError):
        return create_error_response(403, "forbidden", str(exc))

    @app.exception_handler(MemberGroupMismatchError)
    async def member_group_mismatch_handler(request: Request, exc: MemberGroupMismatchError):
        return create_error_response(403, "forbidden", str(exc))

    @app.exception_handler(ClaimNotApprovedError)
    async def claim_not_approved_handler(request: Request, exc: ClaimNotApprovedError):
        return create_error_response(403, "claim_not_approved", str(exc))

    @app.exception_handler(MemberInactiveError)
    async def member_inactive_handler(request: Request, exc: MemberInactiveError):
        return create_error_response(403, "member_inactive", str(exc))

    @app.exception_handler(GroupNotFoundError)
    async def group_not_found_handler(request: Request, exc: GroupNotFoundError):
        return create_error_response(404, "not_found", str(exc))

    @app.exception_handler(MemberNotFoundError)
    async def member_not_found_handler(request: Request, exc: MemberNotFoundError):
        return create_error_response(404, "not_found", str(exc))

    @app.exception_handler(PollNotFoundError)
    async def poll_not_found_handler(request: Request, exc: PollNotFoundError):
        return create_error_response(404, "not_found", str(exc))

    @app.exception_handler(OptionNotFoundError)
    async def option_not_found_handler(request: Request, exc: OptionNotFoundError):
        return create_error_response(404, "not_found", str(exc))

    @app.exception_handler(PollClosedError)
    async def poll_closed_handler(request: Request, exc: PollClosedError):
        return create_error_response(409, "poll_closed", str(exc))

    @app.exception_handler(ClaimConflictError)
    async def claim_conflict_handler(request: Request, exc: ClaimConflictError):
        return create_error_response(409, "name_already_claimed", str(exc))

    @app.exception_handler(ClaimStateError)
    async def claim_state_handler(request: Request, exc: ClaimStateError):
        return create_error_response(409, "invalid_claim_state", str(exc))

    @app.exception_handler(PollValidationError)
    async def poll_validation_handler(request: Request, exc: PollValidationError):
        return create_error_response(422, "validation_error", str(exc))

    @app.exception_handler(OptionPollMismatchError)
    async def option_poll_mismatch_handler(request: Request, exc: OptionPollMismatchError):
        return create_error_response(422, "validation_error", str(exc))

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, exc: IntegrityError):
        # Never leak database error details; return 409 conflict
        return create_error_response(409, "conflict", "Database conflict occurred.")

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        code_map = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
        }
        code = code_map.get(exc.status_code, "http_error")
        detail = str(exc.detail) if exc.detail else "An HTTP error occurred."
        return create_error_response(exc.status_code, code, detail)
