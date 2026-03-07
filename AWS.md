# AWS Integration

Coworker integrates with AWS services for cloud file storage, persistent knowledge graphs, and background task processing.

## Services

### S3 — File Storage
- Upload files to the `coworker-uploads` bucket
- Generate presigned URLs (1hr expiry) for sharing
- List and delete files by prefix

### DynamoDB — Knowledge Graph
- Store entities with type, name, and observations
- Create relationships between entities
- Query entities by type via GSI
- Key schema: `PK=ENTITY#<id>`, `SK=META` for entities, `SK=REL#<to>#<type>` for relations

### SQS — Background Tasks
- Queue async tasks with type, payload, and priority (low/normal/high)
- Long-poll consumer for processing messages
- Monitor queue depth and in-flight messages

## Agent Tools

Three Mastra tools are registered on the Coworker agent:

| Tool | Description |
|------|-------------|
| `uploadFile` | Upload a file to S3 and get a presigned URL |
| `knowledgeGraph` | Add/query/delete entities and relations in DynamoDB |
| `backgroundTask` | Enqueue async work or check queue stats via SQS |

## Configuration

Add these to your `.env`:

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=coworker-uploads
AWS_DYNAMODB_TABLE=coworker-knowledge-graph
AWS_SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/coworker-tasks
```

When AWS env vars are not set, the tools gracefully return an error message and existing local functionality is unaffected.

## Testing

Run the test script to verify all three services:

```bash
npx tsx src/mastra/aws/test-aws.ts
```

## File Structure

```
src/mastra/aws/
├── clients.ts     # Lazy singleton AWS clients
├── s3.ts          # S3 file operations
├── dynamodb.ts    # DynamoDB knowledge graph CRUD
├── sqs.ts         # SQS task queue operations
└── test-aws.ts    # Integration test script

src/mastra/tools/
└── aws-tools.ts   # Mastra tool wrappers
```
