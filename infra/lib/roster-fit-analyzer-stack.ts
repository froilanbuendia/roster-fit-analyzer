import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as synthetics from "aws-cdk-lib/aws-synthetics";
import * as path from "path";

export class RosterFitAnalyzerStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Single table, multiple item types (PLAYER / BASELINE / ROSTER) ---
    this.table = new dynamodb.Table(this, "RosterFitAnalyzerTable", {
      tableName: "RosterFitAnalyzer",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // don't lose data on stack teardown
    });

    // --- GSI to query "all items of a given type" (e.g. all PLAYER items)
    // without a full table Scan. Optional at this data size, but a
    // more textbook DynamoDB access pattern than relying on Scan alone.
    this.table.addGlobalSecondaryIndex({
      indexName: "EntityTypeIndex",
      partitionKey: {
        name: "entity_type",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "PK", type: dynamodb.AttributeType.STRING },
    });

    // --- Lambda: single function, internally routed by path.
    // The table is read-only from this API's perspective and every
    // route does a simple lookup, so one function keeps deployment
    // simple without sacrificing a REST-style API surface. A stricter
    // one-function-per-route split is a reasonable alternative if this
    // ever needs per-route IAM scoping or independent scaling.
    //
    // Explicit log group (instead of the default unbounded-retention
    // group Lambda creates automatically) so logs don't accumulate
    // forever in CloudWatch.
    const rosterApiLogGroup = new logs.LogGroup(this, "RosterApiLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Explicit timeout (CDK's implicit default is 3s, which is tight for
    // a cold-started Node function making DynamoDB calls) — also gives
    // the duration alarm below a stable value to alarm a percentage of.
    const rosterApiTimeout = cdk.Duration.seconds(10);

    const rosterApiFn = new NodejsFunction(this, "RosterApiFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../lambda/roster-api/index.mjs"),
      handler: "handler",
      logGroup: rosterApiLogGroup,
      timeout: rosterApiTimeout,
      environment: {
        TABLE_NAME: this.table.tableName,
        LOG_LEVEL: "INFO",
        POWERTOOLS_SERVICE_NAME: "roster-api",
      },
    });

    this.table.grantReadData(rosterApiFn);
    this.table.grant(rosterApiFn, "dynamodb:DescribeTable");

    // --- HTTP API with REST-style resource routes ---
    const httpApi = new apigatewayv2.HttpApi(this, "RosterApi", {
      corsPreflight: {
        allowOrigins: [
          "https://d1iwvnizbo7jos.cloudfront.net",
          "http://localhost:3000",
        ],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET],
        allowHeaders: ["content-type"],
      },
    });

    const integration = new HttpLambdaIntegration(
      "RosterApiIntegration",
      rosterApiFn,
    );

    httpApi.addRoutes({
      path: "/health",
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: "/players",
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: "/players/{id}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: "/baseline/{season}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: "/roster/{season}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
    });

    // --- Alerting: SNS topic + email subscription, fed by CloudWatch
    // alarms below. Minimal alarm set for a low-traffic API — alarm on
    // symptoms (errors, 5xx) rather than every underlying metric.
    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: "RosterFitAnalyzerAlerts",
    });
    alertTopic.addSubscription(
      new snsSubscriptions.EmailSubscription("froilangbuendia@gmail.com"),
    );

    const lambdaErrorsAlarm = new cloudwatch.Alarm(this, "RosterApiErrorsAlarm", {
      alarmDescription: "RosterApiFunction raised one or more errors",
      metric: rosterApiFn.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: "sum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // Low-traffic API: "no data" just means no invocations, not a failure.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    lambdaErrorsAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const api5xxAlarm = new cloudwatch.Alarm(this, "RosterApi5xxAlarm", {
      alarmDescription: "RosterApi returned one or more 5xx responses",
      metric: httpApi.metricServerError({
        period: cdk.Duration.minutes(5),
        statistic: "sum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    api5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // DynamoDB throttling — this API only ever does GetItem/Query against
    // the table. PAY_PER_REQUEST billing scales automatically, so
    // throttling is rare, but a real spike (e.g. a hot partition or a
    // burst above the burst-capacity ceiling) shows up here even when
    // it doesn't (yet) surface as a Lambda error.
    const dynamoThrottleAlarm = new cloudwatch.Alarm(this, "TableThrottleAlarm", {
      alarmDescription: "RosterFitAnalyzer table is throttling GetItem/Query requests",
      metric: this.table.metricThrottledRequestsForOperations({
        operations: [dynamodb.Operation.GET_ITEM, dynamodb.Operation.QUERY],
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dynamoThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // Lambda duration approaching timeout — catches slow downstream
    // calls (DynamoDB latency, cold starts) before they turn into hard
    // timeouts, which would otherwise only show up as generic 5xx/errors.
    const lambdaDurationAlarm = new cloudwatch.Alarm(this, "RosterApiDurationAlarm", {
      alarmDescription: "RosterApiFunction p99 duration is approaching its configured timeout",
      metric: rosterApiFn.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: "p99",
      }),
      threshold: rosterApiTimeout.toMilliseconds() * 0.8,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    lambdaDurationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    new cdk.CfnOutput(this, "AlertTopicArn", {
      value: alertTopic.topicArn,
    });

    // --- Dashboard: the exact metrics/queries the runbook (RUNBOOK.md)
    // sends you to during triage, on one screen, so an alarm email leads
    // straight here instead of hunting through the console for the
    // right graph.
    const dashboard = new cloudwatch.Dashboard(this, "RosterApiDashboard", {
      dashboardName: "RosterFitAnalyzer",
    });

    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: "Alarms",
        alarms: [
          lambdaErrorsAlarm,
          api5xxAlarm,
          dynamoThrottleAlarm,
          lambdaDurationAlarm,
        ],
        width: 24,
        height: 4,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Lambda errors & throttles",
        left: [
          rosterApiFn.metricErrors({ statistic: "sum" }),
          rosterApiFn.metricThrottles({ statistic: "sum" }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda duration (p50 / p99) vs. timeout",
        left: [
          rosterApiFn.metricDuration({ statistic: "p50" }),
          rosterApiFn.metricDuration({ statistic: "p99" }),
        ],
        leftAnnotations: [
          {
            value: rosterApiTimeout.toMilliseconds(),
            label: "timeout",
            color: cloudwatch.Color.RED,
          },
        ],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "API Gateway 4xx / 5xx",
        left: [
          httpApi.metricClientError({ statistic: "sum" }),
          httpApi.metricServerError({ statistic: "sum" }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "API Gateway latency (avg / p99)",
        left: [
          httpApi.metricLatency({ statistic: "avg" }),
          httpApi.metricLatency({ statistic: "p99" }),
        ],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "DynamoDB throttled requests (GetItem / Query)",
        left: [
          this.table.metricThrottledRequestsForOperations({
            operations: [dynamodb.Operation.GET_ITEM, dynamodb.Operation.QUERY],
          }),
        ],
        width: 12,
      }),
      new cloudwatch.LogQueryWidget({
        title: "Recent Lambda errors",
        logGroupNames: [rosterApiLogGroup.logGroupName],
        view: cloudwatch.LogQueryVisualizationType.TABLE,
        queryLines: [
          "fields @timestamp, message, routeKey, error.name, error.message",
          'filter level = "ERROR"',
          "sort @timestamp desc",
          "limit 20",
        ],
        width: 12,
        height: 6,
      }),
    );

    const dashboardUrl = `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`;

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: dashboardUrl,
    });

    // --- Frontend hosting: S3 + CloudFront, same pattern as the
    // portfolio site, but using CloudFront's default domain instead
    // of a custom domain/ACM cert/Route 53 — not needed for a
    // secondary project reached via a direct link.
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
    });

    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
    });

    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });

    // --- Synthetics canary: end-to-end check of the public surface
    // (API health + frontend), on its own schedule rather than relying
    // on real user traffic to exercise these paths.
    const canary = new synthetics.Canary(this, "AvailabilityCanary", {
      canaryName: "roster-fit-availability",
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_13_0,
      test: synthetics.Test.custom({
        code: synthetics.Code.fromAsset(path.join(__dirname, "../canary")),
        handler: "canary.handler",
      }),
      schedule: synthetics.Schedule.rate(cdk.Duration.minutes(5)),
      environmentVariables: {
        HEALTH_URL: `${httpApi.apiEndpoint}/health`,
        SITE_URL: `https://${distribution.distributionDomainName}`,
      },
    });

    const canaryFailedAlarm = new cloudwatch.Alarm(this, "CanaryFailedAlarm", {
      alarmDescription:
        "Availability canary failed to reach /health or the frontend",
      metric: canary.metricSuccessPercent({
        period: cdk.Duration.minutes(5),
        statistic: "avg",
      }),
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      // Unlike the app alarms above, missing data here means the canary
      // itself isn't running on its 5-minute schedule — that's a failure,
      // not a quiet period.
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    canaryFailedAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(alertTopic),
    );

    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: "Canary",
        alarms: [canaryFailedAlarm],
        width: 24,
        height: 4,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Canary success % / duration",
        left: [canary.metricSuccessPercent({ statistic: "avg" })],
        right: [canary.metricDuration({ statistic: "avg" })],
        width: 12,
      }),
    );

    // --- GitHub Actions OIDC — keyless deploys from CI.
    // One OIDC provider per URL is allowed per account; import the existing one
    // rather than creating a second.
    const githubProvider =
      iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
        this,
        "GitHubOidcProvider",
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
      );

    const deployRole = new iam.Role(this, "GitHubActionsDeployRole", {
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub":
              "repo:froilanbuendia/roster-fit-analyzer:ref:refs/heads/main",
          },
        },
      ),
    });

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"],
        resources: [`${siteBucket.bucketArn}/*`],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [siteBucket.bucketArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    new cdk.CfnOutput(this, "DeployRoleArn", {
      value: deployRole.roleArn,
    });
  }
}
