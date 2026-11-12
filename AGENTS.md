# Agent Rules

This repository is worked on with Claude Code and Codex. These rules apply to any coding agent working here. A human reviews every change and runs every deployment

## Scope

- Change only what the task asks for. No drive-by refactors, renames, or dependency upgrades
- Keep the blueprint small: one `index.ts`, plain Pulumi resources, no component libraries
- If a change adds a resource with a recurring cost (NAT Gateway, extra ALB, VPC endpoints), say so before writing it

## Never

- Run `pulumi up`, `pulumi destroy`, `pulumi refresh --yes`, `pulumi import`, `pulumi state ...`, or `pulumi stack rm`
- Run git commands that change history or the remote: commit, push, reset, rebase, tag
- Read, print, or write credentials, `.env` files, or stack config files (`Pulumi.*.yaml`)
- Put account IDs, ARNs, profile names, or real hostnames in committed files
- Weaken or disable a rule in `policy/` to make a preview pass. Fix the resource instead, or stop and ask
- Change files in `.github/workflows/` or `ci/` unless the task is about CI

## Checks You May Run

- `npm run build` (TypeScript check, no AWS access needed)
- `pulumi preview --policy-pack policy` only when the human has already selected a stack in a test account

## Done Means

- `npm run build` passes
- README is updated if resources, config keys, defaults, or outputs changed
- The final message lists changed files and what the reviewer should check in the preview: replacements, deletions, IAM changes, security group changes

## Style

- No em dashes in code, comments, or docs
- Sparse, practical comments. No comments that restate the code
- No marketing wording in the README
