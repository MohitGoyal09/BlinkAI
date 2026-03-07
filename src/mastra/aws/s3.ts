import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client } from "./clients";

const bucket = () => process.env.AWS_S3_BUCKET ?? "coworker-uploads";

export async function uploadFile(
  key: string,
  body: Buffer | string,
  contentType: string,
): Promise<string> {
  await getS3Client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

export async function getFileUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn },
  );
}

export async function deleteFile(key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
  );
}

export async function listFiles(prefix: string): Promise<string[]> {
  const res = await getS3Client().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix }),
  );
  return (res.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}
