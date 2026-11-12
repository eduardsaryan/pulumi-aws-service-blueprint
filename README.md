# Pulumi AWS Service Blueprint

Small Pulumi blueprint for running a container service on AWS

It creates a simple ECS/Fargate service behind an Application Load Balancer. The default layout uses public subnets and no NAT Gateway, so the first preview stays easy to understand and avoids the usual NAT cost surprise

This is intentionally separate from the OpenTofu starter kit. Same AWS target, different IaC model

## How This Repo Is Worked On

Code changes are written with Claude Code and Codex. The agent writes, a human reviews, CI checks, and a human deploys

- `AGENTS.md`: rules for any coding agent: scope, forbidden commands, what "done" means
- `CLAUDE.md` and `.claude/settings.json`: the same rules for Claude Code, with deploy, destroy, state, and git-write commands blocked at the tool level
- `policy/`: Pulumi policy pack that runs on every preview and deploy. It blocks public ingress other than 80/443, AdministratorAccess on roles, log groups without retention, and missing tags. It warns on NAT Gateways
- `.github/workflows/preview.yml`: TypeScript checks on every pull request, plus `pulumi preview` with a read-only AWS role once configured
- `.github/workflows/deploy.yml`: manual deploy or destroy, gated by a GitHub environment that needs human approval before AWS credentials are issued

Agents never hold deploy credentials. A broken or unsafe change is meant to be stopped by review, by a policy violation, or by the approval gate, not by trusting the agent

## What It Creates

- VPC with two public subnets
- Internet Gateway and public route table
- Application Load Balancer
- ECS cluster
- Fargate task definition and service
- CloudWatch log group
- IAM execution role
- security groups for the load balancer and service

## Default Settings

| Setting | Default |
| --- | --- |
| AWS region | `us-east-1` |
| VPC CIDR | `10.30.0.0/16` |
| public subnet A | `10.30.0.0/20` in `us-east-1a` |
| public subnet B | `10.30.16.0/20` in `us-east-1b` |
| container image | `nginx:1.27-alpine` |
| container port | `80` |
| desired task count | `1` |
| task CPU | `256` |
| task memory | `512` |
| health check path | `/` |

Tasks run in public subnets with public IPs enabled. There is no NAT Gateway in the default layout

## Prerequisites

Use a test AWS account. Do not start with a production account

Required local tools:

- Node.js 24 or newer
- npm
- Pulumi CLI
- AWS CLI

Required AWS access:

- an AWS account you can create test resources in
- permission to create VPC, subnet, route table, Internet Gateway, ALB, ECS, IAM role, CloudWatch Logs, and security group resources
- one working AWS credential path:
  - AWS SSO profile
  - IAM access key in environment variables
  - IAM access key configured with `aws configure`

## Install Local Tools

### macOS

Install tools with Homebrew:

```bash
brew install node pulumi awscli
```

Check tools:

```bash
node --version
npm --version
pulumi version
aws --version
```

Node.js must be version 24 or newer

### Debian or Ubuntu

Install base packages:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates unzip
```

Install Node.js 24:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

Install Pulumi:

```bash
curl -fsSL https://get.pulumi.com | sh
export PATH="$HOME/.pulumi/bin:$PATH"
pulumi version
```

Install the AWS CLI:

```bash
arch="$(uname -m)"
case "${arch}" in
  x86_64) aws_arch="x86_64" ;;
  aarch64|arm64) aws_arch="aarch64" ;;
  *) echo "unsupported AWS CLI architecture: ${arch}" >&2; exit 1 ;;
esac
curl "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip
```

Check tools:

```bash
node --version
npm --version
pulumi version
aws --version
```

## AWS Credentials

Choose one credential path

### AWS SSO

Configure the profile:

```bash
aws configure sso
```

Log in:

```bash
aws sso login --profile my-sso-profile
```

Use the profile for Pulumi commands:

```bash
export AWS_PROFILE=my-sso-profile
aws sts get-caller-identity
```

### Access Keys

Configure a local AWS CLI profile:

```bash
aws configure --profile test-account
export AWS_PROFILE=test-account
aws sts get-caller-identity
```

Or use environment variables:

```bash
export AWS_ACCESS_KEY_ID=replace-me
export AWS_SECRET_ACCESS_KEY=replace-me
export AWS_REGION=us-east-1
aws sts get-caller-identity
```

The `aws sts get-caller-identity` command should show the account you expect before you run `pulumi preview`

## Pulumi Login

Use the Pulumi managed backend:

```bash
pulumi login
```

Or use a local state directory for a disposable test:

```bash
pulumi login file://~/.pulumi-local-state
```

For shared work, use Pulumi Cloud, an S3 backend, or another agreed backend instead of local state

## First Preview

Install project dependencies:

```bash
npm install
npm install --prefix policy
```

Create a stack:

```bash
pulumi stack init dev
```

Set region and base config:

```bash
pulumi config set aws:region us-east-1
pulumi config set projectName demo-service
pulumi config set environment dev
```

The default image is `nginx:1.27-alpine`

Optional config:

```bash
pulumi config set containerImage nginx:1.27-alpine
pulumi config set containerPort 80
pulumi config set desiredCount 1
pulumi config set cpu 256
pulumi config set memory 512
pulumi config set healthCheckPath /
pulumi config set vpcCidr 10.30.0.0/16
pulumi config set --path 'availabilityZones[0]' us-east-1a
pulumi config set --path 'availabilityZones[1]' us-east-1b
pulumi config set --path 'publicSubnetCidrs[0]' 10.30.0.0/20
pulumi config set --path 'publicSubnetCidrs[1]' 10.30.16.0/20
```

`projectName` and `environment` should use lowercase letters, numbers, and hyphens. Keep them short because AWS load balancer and target group names have tight limits

Run preview with the policy pack:

```bash
pulumi preview --policy-pack policy
```

Read the resource list before deploying. Preview should show VPC, subnet, ALB, ECS, IAM, CloudWatch Logs, and security group resources, and no policy violations

## Deploy

Deploy:

```bash
pulumi up --policy-pack policy
```

To deploy from GitHub Actions instead, follow `ci/README.md`

Pulumi prints the load balancer URL as `url`

Verify with curl:

```bash
pulumi stack output url
curl "$(pulumi stack output url)"
```

The default nginx service should return an HTML response

## Cleanup

Destroy the AWS resources:

```bash
pulumi destroy
```

Remove the local stack record:

```bash
pulumi stack rm dev
```

Check the AWS console after cleanup if a failed deploy was interrupted

## Network Notes

This blueprint keeps the service in public subnets with task public IPs enabled. That is acceptable for a small demo service behind an ALB, but it is not the private production pattern

For a stricter production layout, move tasks to private subnets and add one of these egress paths:

- NAT Gateway
- VPC endpoints for the AWS APIs and image/log paths you use

That tradeoff is left explicit because NAT Gateway has a recurring cost even when the service is idle

## Repository Layout

```text
index.ts                  service resources
package.json
Pulumi.yaml
tsconfig.json
policy/                   Pulumi policy pack
ci/                       one-time AWS and GitHub setup for CI
.github/workflows/        preview and deploy workflows
AGENTS.md                 rules for coding agents
CLAUDE.md                 Claude Code entry point
.claude/settings.json     Claude Code command allow and deny lists
```

## Current Limits

- HTTP only by default
- no Route 53 record
- no ACM certificate
- no autoscaling policy
- no lockfile committed yet, so CI uses `npm install` instead of `npm ci`

Those are good next additions after the base preview and deploy path are proven
