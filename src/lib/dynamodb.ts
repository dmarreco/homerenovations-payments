/**
 * DynamoDB Document Client singleton and typed helpers.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const defaultClient = new DynamoDBClient({
  ...(process.env.AWS_REGION && { region: process.env.AWS_REGION }),
});

export const docClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: { convertEmptyValues: false, removeUndefinedValues: true },
});

export async function getItem<T>(
  tableName: string,
  key: Record<string, unknown>
): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({ TableName: tableName, Key: key })
  );
  return (result.Item as T) ?? null;
}

export async function putItem(
  tableName: string,
  item: Record<string, unknown>,
  condition?: string,
  attrNames?: Record<string, string>,
  attrValues?: Record<string, unknown>
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
      ...(condition && {
        ConditionExpression: condition,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
      }),
    })
  );
}

export async function queryItems<T>(
  tableName: string,
  keyCondition: string,
  attrValues: Record<string, unknown>,
  options?: { indexName?: string; scanIndexForward?: boolean; limit?: number; exclusiveStartKey?: Record<string, unknown> }
): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: attrValues,
      IndexName: options?.indexName,
      ScanIndexForward: options?.scanIndexForward,
      Limit: options?.limit,
      ExclusiveStartKey: options?.exclusiveStartKey,
    })
  );
  return {
    items: (result.Items as T[]) ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
  };
}

export async function updateItem(
  tableName: string,
  key: Record<string, unknown>,
  updateExpression: string,
  attrNames: Record<string, string>,
  attrValues: Record<string, unknown>,
  condition?: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
      ConditionExpression: condition,
    })
  );
}

export async function deleteItem(tableName: string, key: Record<string, unknown>): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: tableName, Key: key }));
}
