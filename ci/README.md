# CI Setup

One-time setup so GitHub Actions can preview and deploy without stored AWS keys. Use a test AWS account

Until the repository variable `AWS_PREVIEW_ROLE_ARN` is set, the `preview` job is skipped and only the TypeScript checks run

## 1. Replace Placeholders

In the three JSON files in this directory, replace:

- `ACCOUNT_ID` with your AWS account ID
- `GITHUB_OWNER` with your GitHub user or organization

Do not commit the edited files. Keep the placeholders in the repository

## 2. GitHub OIDC Provider

Skip this if the account already has it:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

## 3. Preview Role (read-only)

```bash
aws iam create-role \
  --role-name gha-service-blueprint-preview \
  --assume-role-policy-document file://ci/preview-trust-policy.json

aws iam attach-role-policy \
  --role-name gha-service-blueprint-preview \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
```

Pull requests and pushes to `main` can assume this role. It cannot change anything

## 4. Deploy Role

```bash
aws iam create-role \
  --role-name gha-service-blueprint-deploy \
  --assume-role-policy-document file://ci/deploy-trust-policy.json

aws iam put-role-policy \
  --role-name gha-service-blueprint-deploy \
  --policy-name service-blueprint-deploy \
  --policy-document file://ci/deploy-permissions.json
```

Only jobs running in the GitHub environment `dev` can assume this role. It can create the execution role and attach only `AmazonECSTaskExecutionRolePolicy` to it

## 5. GitHub Settings

Settings, Environments, New environment `dev`:

- Required reviewers: yourself
- Deployment branches: `main` only
- Environment variable `AWS_DEPLOY_ROLE_ARN`: the deploy role ARN

Settings, Secrets and variables, Actions:

- Secret `PULUMI_ACCESS_TOKEN`: a Pulumi Cloud access token
- Variable `AWS_PREVIEW_ROLE_ARN`: the preview role ARN
- Variable `AWS_REGION`: optional, defaults to `us-east-1`
- Variable `PULUMI_STACK`: optional, defaults to `dev`

Settings, Branches: protect `main` and require the `check` and `preview` jobs to pass before merge

## 6. Deploy

Actions, `deploy`, Run workflow, choose `up` or `destroy`. The job waits for your approval before it gets AWS credentials

## Cleanup

```bash
aws iam delete-role-policy --role-name gha-service-blueprint-deploy --policy-name service-blueprint-deploy
aws iam delete-role --role-name gha-service-blueprint-deploy
aws iam detach-role-policy --role-name gha-service-blueprint-preview --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
aws iam delete-role --role-name gha-service-blueprint-preview
```

## Limits

- The deploy role allows all EC2, ELB, ECS, and CloudWatch Logs actions. Fine for a dedicated test account, too broad for a shared one
- Pulumi state uses Pulumi Cloud. Switching to an S3 backend needs extra permissions on the deploy role
