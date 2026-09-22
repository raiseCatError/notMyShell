# Security Policy

Security is critical for NMSh, as it executes and presents shell commands and handles PTY input/output. Security reports are treated seriously.

## Supported Versions

Formal stable version releases do not exist yet. Security fixes currently target the latest `master` branch (and the latest published release when releases begin).

## Scope

Examples of in-scope security vulnerabilities include:
- Command injection
- Unintended command execution
- Unsafe shell escaping
- Environment leakage
- Terminal escape handling vulnerabilities
- Arbitrary file access
- Privilege or security boundary mistakes
- Unsafe configuration writes

## Reporting a Vulnerability

**Please do not open a public issue for a suspected security vulnerability.** 

Use GitHub's private vulnerability reporting / Security Advisory feature for this repository (under the "Security" tab). If private vulnerability reporting is not currently available, please check if the repository owner has updated contact mechanisms in this file, or reach out through GitHub's standard moderation/contact mechanisms.
