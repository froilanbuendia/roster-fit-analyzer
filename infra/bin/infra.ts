import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { RosterFitAnalyzerStack } from "../lib/roster-fit-analyzer-stack";

const app = new cdk.App();
new RosterFitAnalyzerStack(app, "RosterFitAnalyzerStack", {
  env: {
    account: process.env.CDK_ACCOUNT,
    region: process.env.CDK_REGION,
  },
});
