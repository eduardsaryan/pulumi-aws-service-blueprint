import * as aws from "@pulumi/aws";
import { PolicyPack, ReportViolation, validateResourceOfType } from "@pulumi/policy";

const publicPorts = [80, 443];
const requiredTags = ["Project", "Environment", "ManagedBy"];

function checkOpenIngress(
  fromPort: number | undefined,
  toPort: number | undefined,
  openToInternet: boolean,
  reportViolation: ReportViolation,
) {
  if (!openToInternet) {
    return;
  }
  const allowed = publicPorts.some((port) => fromPort === port && toPort === port);
  if (!allowed) {
    reportViolation(`Ingress ${fromPort}-${toPort} is open to the internet. Only ports 80 and 443 may be public`);
  }
}

new PolicyPack("service-guardrails", {
  policies: [
    {
      name: "no-public-ingress-except-http",
      description: "Only HTTP and HTTPS may be open to 0.0.0.0/0 or ::/0",
      enforcementLevel: "mandatory",
      validateResource: [
        validateResourceOfType(aws.ec2.SecurityGroup, (sg, _args, reportViolation) => {
          for (const rule of sg.ingress ?? []) {
            const open =
              (rule.cidrBlocks ?? []).includes("0.0.0.0/0") || (rule.ipv6CidrBlocks ?? []).includes("::/0");
            checkOpenIngress(rule.fromPort, rule.toPort, open, reportViolation);
          }
        }),
        validateResourceOfType(aws.ec2.SecurityGroupRule, (rule, _args, reportViolation) => {
          if (rule.type !== "ingress") {
            return;
          }
          const open =
            (rule.cidrBlocks ?? []).includes("0.0.0.0/0") || (rule.ipv6CidrBlocks ?? []).includes("::/0");
          checkOpenIngress(rule.fromPort, rule.toPort, open, reportViolation);
        }),
        validateResourceOfType(aws.vpc.SecurityGroupIngressRule, (rule, _args, reportViolation) => {
          const open = rule.cidrIpv4 === "0.0.0.0/0" || rule.cidrIpv6 === "::/0";
          checkOpenIngress(rule.fromPort, rule.toPort, open, reportViolation);
        }),
      ],
    },
    {
      name: "no-admin-policy-attachment",
      description: "Roles created by this stack must not get AdministratorAccess",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(aws.iam.RolePolicyAttachment, (attachment, _args, reportViolation) => {
        if (attachment.policyArn?.endsWith(":policy/AdministratorAccess")) {
          reportViolation("AdministratorAccess must not be attached to a role in this stack");
        }
      }),
    },
    {
      name: "log-retention-set",
      description: "Log groups must have a retention period so logs do not grow forever",
      enforcementLevel: "mandatory",
      validateResource: validateResourceOfType(aws.cloudwatch.LogGroup, (logGroup, _args, reportViolation) => {
        if (!logGroup.retentionInDays) {
          reportViolation("Set retentionInDays on every log group");
        }
      }),
    },
    {
      name: "required-tags",
      description: `Main resources must carry ${requiredTags.join(", ")} tags`,
      enforcementLevel: "mandatory",
      validateResource: (args, reportViolation) => {
        const tagged =
          args.isType(aws.ec2.Vpc) ||
          args.isType(aws.ec2.Subnet) ||
          args.isType(aws.ec2.SecurityGroup) ||
          args.isType(aws.lb.LoadBalancer) ||
          args.isType(aws.lb.TargetGroup) ||
          args.isType(aws.ecs.Cluster) ||
          args.isType(aws.ecs.Service) ||
          args.isType(aws.iam.Role);
        if (!tagged) {
          return;
        }
        const tags = (args.props.tags ?? {}) as Record<string, string>;
        const missing = requiredTags.filter((tag) => !tags[tag]);
        if (missing.length > 0) {
          reportViolation(`Missing tags: ${missing.join(", ")}`);
        }
      },
    },
    {
      name: "nat-gateway-cost-warning",
      description: "NAT Gateways cost money even when the service is idle",
      enforcementLevel: "advisory",
      validateResource: validateResourceOfType(aws.ec2.NatGateway, (_nat, _args, reportViolation) => {
        reportViolation("NAT Gateway adds a recurring hourly and data cost. Confirm this is intended");
      }),
    },
  ],
});
