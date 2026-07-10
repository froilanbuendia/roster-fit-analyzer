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
    const rosterApiFn = new NodejsFunction(this, "RosterApiFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../lambda/roster-api/index.mjs"),
      handler: "handler",
      environment: {
        TABLE_NAME: this.table.tableName,
      },
    });

    this.table.grantReadData(rosterApiFn);

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
