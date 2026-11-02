"""The JSON-in-prose extractor the grill parses model replies with.

Restated from Kiro Crew's ``llm_helpers._extract_json_of_type`` (a private
helper), unchanged: it is pure, has no policy of its own, and the grill's own
tests pin its behaviour on the replies the planner sees.
"""

from __future__ import annotations

import json
from typing import Any, Callable

_JSON_DECODER = json.JSONDecoder()


def _extract_json_of_type(
    text: str,
    expected_type: type | tuple[type, ...],
    prefer: Callable[[Any], bool] | None = None,
) -> dict | list | None:
    """Extract the first top-level JSON value of *expected_type* embedded in prose.

    Scans successive ``{`` (dict) or ``[`` (list) offsets and uses the stdlib
    ``raw_decode`` to parse a complete JSON value at each — this validates the
    full JSON grammar and correctly handles nesting and string escapes. Returns
    the first value that matches *expected_type*, or None.

    Scanning successive offsets (rather than committing to the first delimiter)
    is what makes this robust to a stray structural brace in the prose preamble
    (e.g. ``"use {placeholder}: {\\"a\\": 1}"``). Only TOP-LEVEL matches count: a
    ``{`` nested inside an earlier-starting ``[ ... ]`` is consumed by that
    array's decode, so a dict request never digs a nested object out of a
    surrounding array.

    When *prefer* is given, a preferred value is returned only when the choice
    is UNAMBIGUOUS: all preferred matches in the text must be equal (a model
    restating the same payload twice is not ambiguity). Two or more DIFFERENT
    preferred matches return None — the caller cannot know which one is the
    real payload, and guessing (e.g. executing a worked example that precedes
    the actual plan) is worse than failing. When no preferred match exists,
    the first type-matching value is returned as a fallback.
    """
    preferred: list[dict | list] = []
    fallback: dict | list | None = None
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        # Only attempt a decode at a JSON container start. Scanning BOTH
        # delimiters in positional order (not just the expected one) is what
        # prevents digging a nested object out of a surrounding array: a
        # leading "[ ... ]" is decoded as a list, found to be the wrong type,
        # and skipped past in full — so a dict request on "[1, {\\"a\\":2}]"
        # returns None rather than the inner {"a":2}.
        if ch not in "{[":
            i += 1
            continue
        try:
            data, end = _JSON_DECODER.raw_decode(text, i)
        except RecursionError:
            # Adversarially deep nesting (e.g. "[" * 100_000 in prose): the
            # stdlib decoder recurses per nesting level and overflows long
            # before any structural bound. This text is untrusted model output,
            # and callers handle only JSONDecodeError (parse_json's ValueError
            # contract, the spine extractor's never-raises contract) — so the
            # error must not escape. Fail the WHOLE scan closed: a truncated
            # scan cannot certify a preferred match as unambiguous, so keeping
            # candidates collected before the bomb would let a worked example
            # launder past the ambiguity refusal.
            # Callers already have recovery paths for None (schema retry loop,
            # the spine's forcing re-emit); salvaging a prefix of a reply that
            # contains a nesting bomb is not worth defeating them.
            return None
        except json.JSONDecodeError:
            i += 1
            continue
        if isinstance(data, expected_type):
            if prefer is None:
                return data  # type: ignore[return-value]
            if prefer(data):
                preferred.append(data)
            elif fallback is None:
                fallback = data  # type: ignore[assignment]
        # Valid JSON that is not an immediate result — skip past its full extent.
        i = end
    if preferred:
        first = preferred[0]
        if all(candidate == first for candidate in preferred[1:]):
            return first
        return None
    return fallback
