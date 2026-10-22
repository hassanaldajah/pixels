"""Run the decoder worker in a separate, resource-limited process.

* Windows: a Job Object caps memory and CPU time, forbids extra processes, blocks desktop/clipboard
  access and kills the worker (and anything it spawned) when the job closes.
* Linux/macOS: setrlimit for address space, CPU time, file size and open files, a fresh session,
  and, when the kernel allows it, a new empty network namespace (`unshare -n`).

Honest limits: this is resource containment, not a full jail. The worker can still read files the
current user can read. Network isolation is enforced by the OS on Linux (when unshare works) and
only by a socket block inside the worker on Windows/macOS. See docs/SECURITY_GATE.md.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class SandboxResult:
    returncode: int | None
    stdout: bytes
    stderr: bytes
    timed_out: bool


@dataclass(frozen=True)
class SandboxCapabilities:
    kind: str
    memory_limit: bool
    cpu_limit: bool
    process_limit: bool
    network_isolated: bool
    notes: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "memory_limit": self.memory_limit,
            "cpu_limit": self.cpu_limit,
            "process_limit": self.process_limit,
            "network_isolated": self.network_isolated,
            "notes": self.notes,
        }


def _clean_env(scratch: Path) -> dict[str, str]:
    env = {"TEMP": str(scratch), "TMP": str(scratch), "TMPDIR": str(scratch)}
    if sys.platform == "win32":
        env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", r"C:\Windows")
    return env


# --------------------------------------------------------------------------- Windows
if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _ntdll = ctypes.WinDLL("ntdll")

    _CREATE_SUSPENDED = 0x00000004
    _CREATE_NO_WINDOW = 0x08000000
    _JOB_EXTENDED_LIMIT_INFO = 9
    _JOB_BASIC_UI_RESTRICTIONS = 4
    _LIMIT_PROCESS_TIME = 0x2
    _LIMIT_ACTIVE_PROCESS = 0x8
    _LIMIT_PROCESS_MEMORY = 0x100
    _LIMIT_JOB_MEMORY = 0x200
    _LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400
    _LIMIT_KILL_ON_JOB_CLOSE = 0x2000
    _UI_RESTRICT_ALL = 0xFF

    class _IoCounters(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            "ReadOps", "WriteOps", "OtherOps", "ReadBytes", "WriteBytes", "OtherBytes")]  # fmt: skip

    class _BasicLimits(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
            ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", _BasicLimits),
            ("IoInfo", _IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    class _UiRestrictions(ctypes.Structure):
        _fields_ = [("UIRestrictionsClass", wintypes.DWORD)]

    _k32.CreateJobObjectW.restype = wintypes.HANDLE
    _k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    _k32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    _k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    _k32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    _k32.CloseHandle.argtypes = [wintypes.HANDLE]
    _ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]

    def _make_job(memory_bytes: int, cpu_seconds: int) -> int:
        job = _k32.CreateJobObjectW(None, None)
        if not job:
            raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
        limits = _ExtendedLimits()
        basic = limits.BasicLimitInformation
        basic.LimitFlags = (
            _LIMIT_PROCESS_TIME | _LIMIT_ACTIVE_PROCESS | _LIMIT_PROCESS_MEMORY | _LIMIT_JOB_MEMORY
            | _LIMIT_KILL_ON_JOB_CLOSE | _LIMIT_DIE_ON_UNHANDLED_EXCEPTION
        )  # fmt: skip
        basic.PerProcessUserTimeLimit = cpu_seconds * 10_000_000  # 100 ns units
        # A venv's python.exe is a launcher that starts the real interpreter: allow exactly those two.
        basic.ActiveProcessLimit = 2
        limits.ProcessMemoryLimit = memory_bytes
        limits.JobMemoryLimit = memory_bytes
        if not _k32.SetInformationJobObject(
            job, _JOB_EXTENDED_LIMIT_INFO, ctypes.byref(limits), ctypes.sizeof(limits)
        ):
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject(limits) failed")
        ui = _UiRestrictions(_UI_RESTRICT_ALL)
        _k32.SetInformationJobObject(
            job, _JOB_BASIC_UI_RESTRICTIONS, ctypes.byref(ui), ctypes.sizeof(ui)
        )
        return int(job)

    def run_sandboxed(
        argv: list[str], *, scratch: Path, timeout: float, memory_bytes: int, cpu_seconds: int
    ) -> SandboxResult:
        job = _make_job(memory_bytes, cpu_seconds)
        proc: subprocess.Popen[bytes] | None = None
        try:
            proc = subprocess.Popen(
                argv, cwd=scratch, env=_clean_env(scratch), stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=_CREATE_SUSPENDED | _CREATE_NO_WINDOW,
            )  # fmt: skip
            handle = int(proc._handle)  # type: ignore[attr-defined]
            if not _k32.AssignProcessToJobObject(job, handle):
                raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
            _ntdll.NtResumeProcess(handle)  # start only once the limits are in force
            try:
                out, err = proc.communicate(timeout=timeout)
                return SandboxResult(proc.returncode, out, err, False)
            except subprocess.TimeoutExpired:
                _k32.TerminateJobObject(job, 1)
                out, err = proc.communicate()
                return SandboxResult(None, out, err, True)
        finally:
            if proc is not None and proc.poll() is None:
                _k32.TerminateJobObject(job, 1)
            _k32.CloseHandle(job)

    FIREWALL_RULE = "Pixels decoder: no network"

    def firewall_blocks(executables: list[str], netsh_output: str) -> bool:
        """True when the rule's listing names this program. A venv's python.exe starts the base one, so both count."""
        shown = netsh_output.lower()
        return FIREWALL_RULE.lower() in shown and all(e.lower() in shown for e in executables)

    def _firewall_rule_active() -> bool:
        try:
            shown = subprocess.run(
                ["netsh", "advfirewall", "firewall", "show", "rule", f"name={FIREWALL_RULE}", "verbose"],
                capture_output=True, text=True, timeout=10, creationflags=_CREATE_NO_WINDOW,
            )  # fmt: skip
        except (OSError, subprocess.SubprocessError):
            return False
        return shown.returncode == 0 and firewall_blocks(
            sorted({sys.executable, getattr(sys, "_base_executable", sys.executable)}), shown.stdout
        )

    def capabilities() -> SandboxCapabilities:
        isolated = _firewall_rule_active()
        notes = (
            ["Windows Firewall blocks this program's network access (rule: " + FIREWALL_RULE + ")."]
            if isolated
            else [
                "Network access is blocked inside the worker, but not by the operating system. "
                "Run scripts/windows-block-network.ps1 as administrator to add a firewall rule."
            ]
        )
        return SandboxCapabilities("windows-job-object", True, True, True, isolated, notes)

else:
    import resource

    _UNSHARE_OK: bool | None = None

    def _unshare_works() -> bool:
        global _UNSHARE_OK
        if _UNSHARE_OK is None:
            exe = shutil.which("unshare")
            _UNSHARE_OK = bool(exe) and (
                subprocess.run([str(exe), "-rn", "true"], capture_output=True, timeout=5).returncode
                == 0
            )
        return _UNSHARE_OK

    def run_sandboxed(
        argv: list[str], *, scratch: Path, timeout: float, memory_bytes: int, cpu_seconds: int
    ) -> SandboxResult:
        def limit() -> None:
            os.setsid()
            if sys.platform != "darwin":  # macOS does not support an address-space limit
                resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 5))
            resource.setrlimit(resource.RLIMIT_FSIZE, (memory_bytes, memory_bytes))
            resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

        command = (["unshare", "-rn", *argv]) if _unshare_works() else argv
        proc = subprocess.Popen(
            command, cwd=scratch, env=_clean_env(scratch), stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=limit,
        )  # fmt: skip
        try:
            out, err = proc.communicate(timeout=timeout)
            return SandboxResult(proc.returncode, out, err, False)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, 9)
            out, err = proc.communicate()
            return SandboxResult(None, out, err, True)

    def capabilities() -> SandboxCapabilities:
        isolated = _unshare_works()
        notes = (
            []
            if isolated
            else ["Network isolation needs `unshare -rn`, which is not available here."]
        )
        if sys.platform == "darwin":
            notes.append("macOS has no address-space limit, so decoder memory is not capped here.")
        return SandboxCapabilities(
            "posix-rlimit", sys.platform != "darwin", True, False, isolated, notes
        )
