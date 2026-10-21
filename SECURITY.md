# Security policy

Pixels opens files that may be hostile, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Use GitHub's private reporting instead:
**Security -> Report a vulnerability** on this repository. Include the Pixels version, your
operating system, and, if you can, a minimal file that reproduces the problem (the generator in
`server/tests/security/fixtures.py` is a good starting point).

You can expect an acknowledgement within a few days. This is a personal open-source project, so
there is no bounty and no guaranteed fix time, but confirmed issues are fixed in the next release
and credited unless you prefer otherwise.

## What is in scope

- Any file that passes the Security Gate but should not have (polyglots, appended payloads,
  parser exploits, metadata that survives sanitising).
- Any way to make the worker use the network, read or write outside its job, or outlive its limits.
- Any way for a web page or another machine to talk to a Pixels backend that is not meant to be
  reachable (Host/Origin/token bypass, DNS rebinding, path traversal, CSP bypass).
- Anything that makes Pixels make an outbound connection.

## What is not

The limits listed under "Honest limits" in [docs/SECURITY_GATE.md](docs/SECURITY_GATE.md) are known
and documented. Pixels says a file "passed Pixels security checks"; it never claims a file is
free of malware.

## Supported versions

Only the latest release.
