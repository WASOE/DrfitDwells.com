#!/usr/bin/env python3
"""Minimal renameat2(RENAME_EXCHANGE) wrapper; never falls back to two renames."""
import ctypes
import os
import sys

AT_FDCWD = -100
RENAME_EXCHANGE = 2

if len(sys.argv) != 3:
    raise SystemExit("usage: rename-exchange.py PATH_A PATH_B")

left, right = (os.fsencode(os.path.abspath(value)) for value in sys.argv[1:])
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = getattr(libc, "renameat2", None)
if renameat2 is None:
    raise SystemExit("renameat2 is unavailable; refusing non-atomic fallback")
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
if renameat2(AT_FDCWD, left, AT_FDCWD, right, RENAME_EXCHANGE) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error), os.fsdecode(left))

