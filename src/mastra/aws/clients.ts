import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";

let s3: S3Client | null = null;
let dynamo: DynamoDBDocumentClient | null = null;
let sqs: SQSClient | null = null;

export function isAwsConfigured(): boolean {
  return !!(
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

function getClientConfig() {
  return {
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  };
}

export function getS3Client(): S3Client {
  if (!s3) s3 = new S3Client(getClientConfig());
  return s3;
}

export function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamo) {
    const raw = new DynamoDBClient(getClientConfig());
    dynamo = DynamoDBDocumentClient.from(raw, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return dynamo;
}

export function getSQSClient(): SQSClient {
  if (!sqs) sqs = new SQSClient(getClientConfig());
  return sqs;
}
