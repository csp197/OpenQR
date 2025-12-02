def normalize_newlines(s: str) -> str:
    """
    Convert all newline variants (\r\n, \n) into a single canonical '\r'.
    """
    if not s:
        return s
    return s.replace("\r\n", "\r").replace("\n", "\r")
