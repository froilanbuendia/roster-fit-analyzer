import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

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

    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
    });
  }
}
