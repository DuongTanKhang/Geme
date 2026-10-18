import hmac


def has_valid_internal_key(expected: str, supplied: str) -> bool:
    if len(expected.encode("utf-8")) < 32 or not supplied:
        return False
    return hmac.compare_digest(supplied, expected)
