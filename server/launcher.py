"""Entry point for the frozen (PyInstaller) backend used by the desktop app.

One executable plays two roles:
  * `pixels-server --port N`            runs the web/API server;
  * `pixels-server --decode-worker ...` runs the sandboxed image decoder (see security/worker.py).

The Security Gate starts its decoder as a separate process; in a frozen build that process is this same
executable, so the worker role has to be reachable from here.
"""

from __future__ import annotations

import multiprocessing
import sys


def main() -> int:
    multiprocessing.freeze_support()
    if len(sys.argv) > 1 and sys.argv[1] == "--decode-worker":
        from security.worker import main as worker_main

        return worker_main(sys.argv[2:])
    from app.__main__ import main as server_main

    server_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
