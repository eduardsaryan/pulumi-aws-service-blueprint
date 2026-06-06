import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

const projectName = config.get("projectName") ?? "demo-service";
const environment = config.get("environment") ?? pulumi.getStack();
const region = aws.config.region ?? "us-east-1";
const vpcCidr = config.get("vpcCidr") ?? "10.30.0.0/16";
const availabilityZones = config.getObject<string[]>("availabilityZones") ?? [`${region}a`, `${region}b`];
const publicSubnetCidrs = config.getObject<string[]>("publicSubnetCidrs") ?? ["10.30.0.0/20", "10.30.16.0/20"];
const containerImage = config.get("containerImage") ?? "nginx:1.27-alpine";
const containerPort = config.getNumber("containerPort") ?? 80;
const desiredCount = config.getNumber("desiredCount") ?? 1;
const cpu = config.getNumber("cpu") ?? 256;
const memory = config.getNumber("memory") ?? 512;
const healthCheckPath = config.get("healthCheckPath") ?? "/";

if (!/^[a-z][a-z0-9-]{1,18}[a-z0-9]$/.test(projectName)) {
  throw new Error("projectName must be 3-20 lowercase letters, numbers, and hyphens");
}

if (!/^[a-z][a-z0-9-]{1,10}[a-z0-9]$/.test(environment)) {
  throw new Error("environment must be 3-12 lowercase letters, numbers, and hyphens");
}

if (availabilityZones.length !== 2 || publicSubnetCidrs.length !== 2) {
  throw new Error("Use exactly two availability zones and two public subnet CIDRs for this blueprint");
}

const namePrefix = `${projectName}-${environment}`;
const commonTags = {
  Project: "pulumi-aws-service-blueprint",
  Service: projectName,
  Environment: environment,
  ManagedBy: "pulumi",
};

const vpc = new aws.ec2.Vpc(`${namePrefix}-vpc`, {
  cidrBlock: vpcCidr,
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: {
    ...commonTags,
    Name: `${namePrefix}-vpc-01`,
  },
});

const internetGateway = new aws.ec2.InternetGateway(`${namePrefix}-igw`, {
  vpcId: vpc.id,
  tags: {
    ...commonTags,
    Name: `${namePrefix}-igw-01`,
  },
});

const publicRouteTable = new aws.ec2.RouteTable(`${namePrefix}-public-rt`, {
  vpcId: vpc.id,
  routes: [
    {
      cidrBlock: "0.0.0.0/0",
      gatewayId: internetGateway.id,
    },
  ],
  tags: {
    ...commonTags,
    Name: `${namePrefix}-public-rt`,
  },
});

const publicSubnets = availabilityZones.map((zone, index) => {
  const suffix = zone.slice(-1);

  const subnet = new aws.ec2.Subnet(`${namePrefix}-public-${suffix}`, {
    vpcId: vpc.id,
    cidrBlock: publicSubnetCidrs[index],
    availabilityZone: zone,
    mapPublicIpOnLaunch: false,
    tags: {
      ...commonTags,
      Name: `${namePrefix}-public-${suffix}`,
      Tier: "public",
    },
  });

  new aws.ec2.RouteTableAssociation(`${namePrefix}-public-${suffix}`, {
    subnetId: subnet.id,
    routeTableId: publicRouteTable.id,
  });

  return subnet;
});

const albSecurityGroup = new aws.ec2.SecurityGroup(`${namePrefix}-alb-sg`, {
  vpcId: vpc.id,
  description: "Public HTTP access to the load balancer",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTP from the internet",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Outbound to service tasks",
    },
  ],
  tags: {
    ...commonTags,
    Name: `${namePrefix}-alb-sg`,
  },
});

const serviceSecurityGroup = new aws.ec2.SecurityGroup(`${namePrefix}-service-sg`, {
  vpcId: vpc.id,
  description: "Service traffic from the load balancer",
  ingress: [
    {
      protocol: "tcp",
      fromPort: containerPort,
      toPort: containerPort,
      securityGroups: [albSecurityGroup.id],
      description: "Container port from ALB",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Outbound for image pulls and logs",
    },
  ],
  tags: {
    ...commonTags,
    Name: `${namePrefix}-service-sg`,
  },
});

const cluster = new aws.ecs.Cluster(`${namePrefix}-cluster`, {
  name: `${namePrefix}-ecs`,
  tags: commonTags,
});

const logGroup = new aws.cloudwatch.LogGroup(`${namePrefix}-logs`, {
  name: `/ecs/${namePrefix}`,
  retentionInDays: 14,
  tags: commonTags,
});

const executionRole = new aws.iam.Role(`${namePrefix}-execution-role`, {
  name: `${namePrefix}-execution-role`,
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ecs-tasks.amazonaws.com",
  }),
  tags: commonTags,
});

new aws.iam.RolePolicyAttachment(`${namePrefix}-execution-policy`, {
  role: executionRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

const taskDefinition = new aws.ecs.TaskDefinition(`${namePrefix}-task`, {
  family: `${namePrefix}-task`,
  requiresCompatibilities: ["FARGATE"],
  networkMode: "awsvpc",
  cpu: cpu.toString(),
  memory: memory.toString(),
  executionRoleArn: executionRole.arn,
  containerDefinitions: pulumi
    .all([logGroup.name])
    .apply(([logGroupName]) =>
      JSON.stringify([
        {
          name: "app",
          image: containerImage,
          essential: true,
          portMappings: [
            {
              containerPort,
              hostPort: containerPort,
              protocol: "tcp",
            },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroupName,
              "awslogs-region": region,
              "awslogs-stream-prefix": "app",
            },
          },
        },
      ]),
    ),
  tags: commonTags,
});

const loadBalancer = new aws.lb.LoadBalancer(`${namePrefix}-alb`, {
  name: `${namePrefix}-alb`,
  loadBalancerType: "application",
  internal: false,
  securityGroups: [albSecurityGroup.id],
  subnets: publicSubnets.map((subnet) => subnet.id),
  tags: {
    ...commonTags,
    Name: `${namePrefix}-alb`,
  },
});

const targetGroup = new aws.lb.TargetGroup(`${namePrefix}-tg`, {
  name: `${namePrefix}-tg`,
  port: containerPort,
  protocol: "HTTP",
  targetType: "ip",
  vpcId: vpc.id,
  healthCheck: {
    enabled: true,
    path: healthCheckPath,
    matcher: "200-399",
  },
  tags: {
    ...commonTags,
    Name: `${namePrefix}-tg`,
  },
});

const listener = new aws.lb.Listener(`${namePrefix}-http`, {
  loadBalancerArn: loadBalancer.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [
    {
      type: "forward",
      targetGroupArn: targetGroup.arn,
    },
  ],
});

const service = new aws.ecs.Service(`${namePrefix}-service`, {
  name: `${namePrefix}-service`,
  cluster: cluster.arn,
  taskDefinition: taskDefinition.arn,
  desiredCount,
  launchType: "FARGATE",
  networkConfiguration: {
    assignPublicIp: true,
    subnets: publicSubnets.map((subnet) => subnet.id),
    securityGroups: [serviceSecurityGroup.id],
  },
  loadBalancers: [
    {
      targetGroupArn: targetGroup.arn,
      containerName: "app",
      containerPort,
    },
  ],
  tags: commonTags,
}, {
  dependsOn: [listener],
});

export const serviceName = service.name;
export const clusterName = cluster.name;
export const loadBalancerDnsName = loadBalancer.dnsName;
export const url = pulumi.interpolate`http://${loadBalancer.dnsName}`;
