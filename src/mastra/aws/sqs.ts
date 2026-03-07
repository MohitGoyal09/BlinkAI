import {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { getSQSClient } from "./clients";

const queueUrl = () => process.env.AWS_SQS_QUEUE_URL!;

export interface BackgroundTask {
  type: string;
  payload: Record<string, unknown>;
  priority?: "low" | "normal" | "high";
}

export async function enqueueTask(task: BackgroundTask): Promise<string> {
  const res = await getSQSClient().send(
    new SendMessageCommand({
      QueueUrl: queueUrl(),
      MessageBody: JSON.stringify(task.payload),
      MessageAttributes: {
        taskType: { DataType: "String", StringValue: task.type },
        priority: { DataType: "String", StringValue: task.priority ?? "normal" },
      },
    }),
  );
  return res.MessageId!;
}

export async function pollTasks(
  handler: (task: BackgroundTask, receiptHandle: string) => Promise<void>,
  maxMessages = 5,
): Promise<number> {
  const res = await getSQSClient().send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl(),
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: 10,
      MessageAttributeNames: ["All"],
    }),
  );

  const messages = res.Messages ?? [];
  for (const msg of messages) {
    const task: BackgroundTask = {
      type: msg.MessageAttributes?.taskType?.StringValue ?? "unknown",
      payload: JSON.parse(msg.Body ?? "{}"),
      priority: (msg.MessageAttributes?.priority?.StringValue as BackgroundTask["priority"]) ?? "normal",
    };
    await handler(task, msg.ReceiptHandle!);
    await getSQSClient().send(
      new DeleteMessageCommand({ QueueUrl: queueUrl(), ReceiptHandle: msg.ReceiptHandle! }),
    );
  }
  return messages.length;
}

export async function getQueueStats(): Promise<{ approximate: number; inFlight: number }> {
  const res = await getSQSClient().send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl(),
      AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    }),
  );
  return {
    approximate: Number(res.Attributes?.ApproximateNumberOfMessages ?? 0),
    inFlight: Number(res.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
  };
}
