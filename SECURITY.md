# Security

## Reporting a vulnerability

Please report suspected vulnerabilities privately through **Report a
vulnerability** on this repository's Security tab. Do not open a public issue
for a security report.

## What Pace touches

Pace is a local command-line toolkit. Most commands read files you point them
at and write JSON or Markdown reports to the output directory you choose.

- **Profiling existing sessions** reads GitHub Copilot CLI event logs locally.
  It does not start Copilot or call a model provider. Profiles omit prompts,
  messages, code, tool inputs and results, and working directories by default.
- **Hosted examples** start GitHub Copilot CLI or call a model provider and can
  incur charges. The Copilot examples expose only the read-only `view` tool by
  default. Run them with a disposable output directory.
- **Direct-model examples** read a short-lived access token from
  `PACE_DIRECT_ACCESS_TOKEN`. Keep tokens and provider endpoints in environment
  variables, never in manifests or committed files. Profiles exclude the
  authorization header, endpoint, and deployment, but raw sample output such as
  `response.txt` and `usage.json` remains in your output directory, and provider
  error messages can be printed to your console.
- **Deterministic receipts** hash-bind the code, input, and output of a local
  transform. They are an audit record, not a sandbox. Only run transforms and
  manifests you trust.

## Keep raw artifacts out of the repository

Session folders, raw provider output, and path-bearing intermediate manifests
can contain private information. `pace-output/` and `.copilot/` are ignored by
default; keep other raw artifacts outside the repository too.
