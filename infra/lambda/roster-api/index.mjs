import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

async function getAllPlayers() {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "EntityTypeIndex",
      KeyConditionExpression: "entity_type = :type",
      ExpressionAttributeValues: { ":type": "PLAYER" },
    }),
  );
  return result.Items;
}

async function getPlayerById(playerId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `PLAYER#${playerId}`, SK: "PROFILE" },
    }),
  );
  return result.Item ?? null;
}

async function getBaseline(season) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `BASELINE#${season}` },
    }),
  );
  return result.Items;
}

async function getRosterComposition(season) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ROSTER#${season}`, SK: "SUMMARY" },
    }),
  );
  return result.Item ?? null;
}

export const handler = async (event) => {
  const routeKey = event.routeKey;

  try {
    switch (routeKey) {
      case "GET /players": {
        const players = await getAllPlayers();
        return jsonResponse(200, players);
      }

      case "GET /players/{id}": {
        const player = await getPlayerById(event.pathParameters.id);
        if (!player) return jsonResponse(404, { message: "Player not found" });
        return jsonResponse(200, player);
      }

      case "GET /baseline/{season}": {
        const baseline = await getBaseline(event.pathParameters.season);
        return jsonResponse(200, baseline);
      }

      case "GET /roster/{season}": {
        const roster = await getRosterComposition(event.pathParameters.season);
        if (!roster)
          return jsonResponse(404, { message: "Roster data not found" });
        return jsonResponse(200, roster);
      }

      default:
        return jsonResponse(404, { message: "Route not found" });
    }
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { message: "Internal server error" });
  }
};
