import {
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "./clients";

const table = () => process.env.AWS_DYNAMODB_TABLE ?? "coworker-knowledge-graph";

export interface KGEntity {
  id: string;
  entityType: string;
  name: string;
  observations: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface KGRelation {
  from: string;
  to: string;
  relationType: string;
  createdAt?: string;
}

export async function putEntity(entity: KGEntity): Promise<void> {
  const now = new Date().toISOString();
  await getDynamoClient().send(
    new PutCommand({
      TableName: table(),
      Item: {
        PK: `ENTITY#${entity.id}`,
        SK: "META",
        GSI1PK: `TYPE#${entity.entityType}`,
        GSI1SK: entity.name,
        ...entity,
        createdAt: entity.createdAt ?? now,
        updatedAt: now,
      },
    }),
  );
}

export async function putRelation(from: string, to: string, relationType: string): Promise<void> {
  await getDynamoClient().send(
    new PutCommand({
      TableName: table(),
      Item: {
        PK: `ENTITY#${from}`,
        SK: `REL#${to}#${relationType}`,
        GSI1PK: `REL#${relationType}`,
        GSI1SK: `${from}#${to}`,
        from,
        to,
        relationType,
        createdAt: new Date().toISOString(),
      },
    }),
  );
}

export async function getEntity(id: string): Promise<KGEntity | null> {
  const res = await getDynamoClient().send(
    new GetCommand({ TableName: table(), Key: { PK: `ENTITY#${id}`, SK: "META" } }),
  );
  return (res.Item as KGEntity) ?? null;
}

export async function getRelations(entityId: string): Promise<KGRelation[]> {
  const res = await getDynamoClient().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `ENTITY#${entityId}`, ":prefix": "REL#" },
    }),
  );
  return (res.Items ?? []) as KGRelation[];
}

export async function queryByType(entityType: string): Promise<KGEntity[]> {
  const res = await getDynamoClient().send(
    new QueryCommand({
      TableName: table(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: { ":gsi1pk": `TYPE#${entityType}` },
    }),
  );
  return (res.Items ?? []) as KGEntity[];
}

export async function deleteEntity(id: string): Promise<void> {
  const relations = await getRelations(id);

  const deletes = [
    { DeleteRequest: { Key: { PK: `ENTITY#${id}`, SK: "META" } } },
    ...relations.map((r) => ({
      DeleteRequest: { Key: { PK: `ENTITY#${id}`, SK: `REL#${r.to}#${r.relationType}` } },
    })),
  ];

  // BatchWrite supports max 25 items per call
  for (let i = 0; i < deletes.length; i += 25) {
    await getDynamoClient().send(
      new BatchWriteCommand({
        RequestItems: { [table()]: deletes.slice(i, i + 25) },
      }),
    );
  }
}
