"""Errors whose message is written for the user and is safe to show as it is.

Anything else that goes wrong while editing (a library's own ValueError, for instance) can carry internal details,
so the API logs it and answers with a generic message instead.
"""

from __future__ import annotations


class PublicError(ValueError):
    """A problem the user can understand and fix. The message is shown to them."""
