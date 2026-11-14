"""A synthetic GitHub token of the real shape, built at run time for redaction tests.

The redactor keeps identifiers visible (an AWS key ID, the AWS documentation
example key), so a test that checks redaction needs a credential the redactor
removes. Kiro Crew's own test trees use ``kiro_crew.testing.synthetic_credentials``
(KiroCrew #31863); the host this suite pins may predate that module, so the same
construction is restated here when it is missing. Built here, not written as a
literal, so no credential-shaped text lands in the repository. None is a real
credential.
"""

from __future__ import annotations

import string
import zlib

_ALNUM = string.ascii_letters + string.digits
_BASE62 = string.digits + string.ascii_uppercase + string.ascii_lowercase


def _synth(n: int, seed: int) -> str:
    """A deterministic string of ``n`` characters that mixes the alphabet's classes."""
    step = 7 if len(_ALNUM) % 7 else 11
    return "".join(_ALNUM[(seed * 13 + i * step) % len(_ALNUM)] for i in range(n))


def _base62_crc32(body: str) -> str:
    """The six-character base62 CRC32 a GitHub token appends to its body."""
    crc = zlib.crc32(body.encode("ascii"))
    digits = ""
    while crc:
        crc, rem = divmod(crc, 62)
        digits = _BASE62[rem] + digits
    return digits.rjust(6, "0")


def github_classic(seed: int = 1) -> str:
    """A GitHub classic token with a valid checksum: the host's helper when it has one."""
    try:
        from kiro_crew.testing.synthetic_credentials import github_classic as host
    except ImportError:
        body = _synth(30, seed)
        return "ghp_" + body + _base62_crc32(body)
    return host(seed=seed)
