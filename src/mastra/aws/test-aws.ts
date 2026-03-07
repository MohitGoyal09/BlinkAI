import "dotenv/config";
import { isAwsConfigured } from "./clients";
import { uploadFile, getFileUrl, listFiles, deleteFile } from "./s3";
import { putEntity, getEntity, getRelations, putRelation, queryByType, deleteEntity } from "./dynamodb";
import { enqueueTask, getQueueStats } from "./sqs";

async function testS3() {
  console.log("\n=== S3 Test ===");
  const key = await uploadFile("test/hello.txt", Buffer.from("Hello from Coworker!"), "text/plain");
  console.log("Uploaded:", key);

  const url = await getFileUrl(key);
  console.log("Presigned URL:", url.slice(0, 80) + "...");

  const files = await listFiles("test/");
  console.log("Files under test/:", files);

  await deleteFile(key);
  console.log("Deleted:", key);
}

async function testDynamoDB() {
  console.log("\n=== DynamoDB Test ===");
  await putEntity({ id: "test-1", entityType: "person", name: "Alice", observations: ["likes coffee"] });
  console.log("Entity created: test-1");

  const entity = await getEntity("test-1");
  console.log("Fetched entity:", entity);

  await putRelation("test-1", "test-2", "knows");
  await putEntity({ id: "test-2", entityType: "person", name: "Bob", observations: ["likes tea"] });
  console.log("Relation + second entity created");

  const relations = await getRelations("test-1");
  console.log("Relations for test-1:", relations);

  const people = await queryByType("person");
  console.log("All persons:", people.map((p) => p.name));

  await deleteEntity("test-1");
  await deleteEntity("test-2");
  console.log("Cleaned up test entities");
}

async function testSQS() {
  console.log("\n=== SQS Test ===");
  const msgId = await enqueueTask({ type: "test-task", payload: { message: "hello" }, priority: "normal" });
  console.log("Enqueued message:", msgId);

  const stats = await getQueueStats();
  console.log("Queue stats:", stats);
}

async function main() {
  console.log("AWS configured:", isAwsConfigured());
  if (!isAwsConfigured()) {
    console.error("Set AWS env vars first!");
    process.exit(1);
  }

  try {
    await testS3();
  } catch (e: any) {
    console.error("S3 error:", e.message);
  }

  try {
    await testDynamoDB();
  } catch (e: any) {
    console.error("DynamoDB error:", e.message);
  }

  try {
    await testSQS();
  } catch (e: any) {
    console.error("SQS error:", e.message);
  }

  console.log("\nDone!");
}

main();
