import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { isAwsConfigured } from "../aws/clients";
import { uploadFile, getFileUrl, listFiles, deleteFile } from "../aws/s3";
import { putEntity, getEntity, getRelations, queryByType, putRelation, deleteEntity } from "../aws/dynamodb";
import { enqueueTask, getQueueStats } from "../aws/sqs";

export const uploadFileTool = createTool({
  id: "upload-file",
  description:
    "Upload a file to cloud storage (S3) and return a shareable presigned URL. " +
    "Use for persisting user-provided files, generated reports, exports, etc.",
  inputSchema: z.object({
    fileName: z.string().describe("File name including extension, e.g. 'report.pdf'"),
    content: z.string().describe("Base64-encoded file content"),
    contentType: z.string().default("application/octet-stream").describe("MIME type"),
    prefix: z.string().default("uploads").describe("S3 key prefix / folder"),
  }),
  execute: async ({ context }) => {
    if (!isAwsConfigured()) return { error: "AWS is not configured" };
    const key = `${context.prefix}/${Date.now()}-${context.fileName}`;
    const body = Buffer.from(context.content, "base64");
    await uploadFile(key, body, context.contentType);
    const url = await getFileUrl(key);
    return { key, url };
  },
});

export const knowledgeGraphTool = createTool({
  id: "knowledge-graph",
  description:
    "Manage a persistent knowledge graph in DynamoDB. " +
    "Supports adding entities, adding relations between entities, querying by ID or type, and deleting entities.",
  inputSchema: z.object({
    action: z.enum(["addEntity", "addRelation", "getEntity", "getRelations", "queryByType", "deleteEntity"]),
    entity: z
      .object({
        id: z.string(),
        entityType: z.string(),
        name: z.string(),
        observations: z.array(z.string()).default([]),
      })
      .optional()
      .describe("Required for addEntity"),
    relation: z
      .object({
        from: z.string(),
        to: z.string(),
        relationType: z.string(),
      })
      .optional()
      .describe("Required for addRelation"),
    entityId: z.string().optional().describe("Required for getEntity, getRelations, deleteEntity"),
    entityType: z.string().optional().describe("Required for queryByType"),
  }),
  execute: async ({ context }) => {
    if (!isAwsConfigured()) return { error: "AWS is not configured" };

    switch (context.action) {
      case "addEntity": {
        if (!context.entity) return { error: "entity is required" };
        await putEntity(context.entity);
        return { success: true, id: context.entity.id };
      }
      case "addRelation": {
        if (!context.relation) return { error: "relation is required" };
        const { from, to, relationType } = context.relation;
        await putRelation(from, to, relationType);
        return { success: true };
      }
      case "getEntity": {
        if (!context.entityId) return { error: "entityId is required" };
        const entity = await getEntity(context.entityId);
        return entity ?? { error: "Entity not found" };
      }
      case "getRelations": {
        if (!context.entityId) return { error: "entityId is required" };
        const relations = await getRelations(context.entityId);
        return { relations };
      }
      case "queryByType": {
        if (!context.entityType) return { error: "entityType is required" };
        const entities = await queryByType(context.entityType);
        return { entities };
      }
      case "deleteEntity": {
        if (!context.entityId) return { error: "entityId is required" };
        await deleteEntity(context.entityId);
        return { success: true };
      }
    }
  },
});

export const backgroundTaskTool = createTool({
  id: "background-task",
  description:
    "Queue a background task via SQS for async processing. " +
    "Use for long-running work like data processing, notifications, or scheduled follow-ups. " +
    "Can also check queue stats.",
  inputSchema: z.object({
    action: z.enum(["enqueue", "stats"]),
    task: z
      .object({
        type: z.string().describe("Task type identifier, e.g. 'send-email', 'process-data'"),
        payload: z.record(z.unknown()).describe("Arbitrary JSON payload for the task"),
        priority: z.enum(["low", "normal", "high"]).default("normal"),
      })
      .optional()
      .describe("Required for enqueue action"),
  }),
  execute: async ({ context }) => {
    if (!isAwsConfigured()) return { error: "AWS is not configured" };

    if (context.action === "enqueue") {
      if (!context.task) return { error: "task is required" };
      const messageId = await enqueueTask(context.task);
      return { success: true, messageId };
    }

    const stats = await getQueueStats();
    return stats;
  },
});
