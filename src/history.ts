import type { AppMode, AttachmentRecordV1, ConversationRecordV1, PersistedMessageV1 } from './types';

const DATABASE_NAME = 'aether.local.history';
const DATABASE_VERSION = 1;
const CONVERSATIONS = 'conversations';
const ATTACHMENTS = 'attachments';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was cancelled.'));
  });
}

export function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open local chat history.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CONVERSATIONS)) {
        const conversations = database.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
        conversations.createIndex('mode', 'mode');
        conversations.createIndex('updatedAt', 'updatedAt');
      }
      if (!database.objectStoreNames.contains(ATTACHMENTS)) {
        const attachments = database.createObjectStore(ATTACHMENTS, { keyPath: 'id' });
        attachments.createIndex('conversationId', 'conversationId');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export function createConversation(mode: AppMode, modelId: string): ConversationRecordV1 {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    version: 1,
    mode,
    title: `New ${mode} chat`,
    selectedModelId: modelId,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

export function createMessage(
  role: PersistedMessageV1['role'],
  text: string,
  modelId: string,
  attachmentIds: string[] = []
): PersistedMessageV1 {
  return { id: crypto.randomUUID(), role, text, createdAt: Date.now(), attachmentIds, modelId };
}

export function deriveConversationTitle(conversation: ConversationRecordV1, fallbackName?: string): string {
  const firstText = conversation.messages.find((message) => message.role === 'user' && message.text.trim())?.text.trim();
  const source = firstText || fallbackName || `${conversation.mode[0]?.toUpperCase()}${conversation.mode.slice(1)} conversation`;
  return source.replace(/\s+/g, ' ').slice(0, 44);
}

export async function saveConversation(conversation: ConversationRecordV1): Promise<void> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction(CONVERSATIONS, 'readwrite');
  transaction.objectStore(CONVERSATIONS).put(conversation);
  await transactionDone(transaction);
  database.close();
}

export async function getConversation(id: string): Promise<ConversationRecordV1 | undefined> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction(CONVERSATIONS, 'readonly');
  const result = await requestResult(transaction.objectStore(CONVERSATIONS).get(id)) as ConversationRecordV1 | undefined;
  database.close();
  return result;
}

export async function listConversations(mode?: AppMode): Promise<ConversationRecordV1[]> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction(CONVERSATIONS, 'readonly');
  const store = transaction.objectStore(CONVERSATIONS);
  const result = mode
    ? await requestResult(store.index('mode').getAll(mode))
    : await requestResult(store.getAll());
  database.close();
  return (result as ConversationRecordV1[]).sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function saveAttachment(attachment: AttachmentRecordV1): Promise<void> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction(ATTACHMENTS, 'readwrite');
  transaction.objectStore(ATTACHMENTS).put(attachment);
  await transactionDone(transaction);
  database.close();
}

export async function getAttachment(id: string): Promise<AttachmentRecordV1 | undefined> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction(ATTACHMENTS, 'readonly');
  const result = await requestResult(transaction.objectStore(ATTACHMENTS).get(id)) as AttachmentRecordV1 | undefined;
  database.close();
  return result;
}

export async function getConversationAttachments(conversationId: string): Promise<AttachmentRecordV1[]> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction(ATTACHMENTS, 'readonly');
  const result = await requestResult(transaction.objectStore(ATTACHMENTS).index('conversationId').getAll(conversationId));
  database.close();
  return result as AttachmentRecordV1[];
}

export async function deleteConversation(id: string): Promise<void> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction([CONVERSATIONS, ATTACHMENTS], 'readwrite');
  transaction.objectStore(CONVERSATIONS).delete(id);
  const attachmentStore = transaction.objectStore(ATTACHMENTS);
  const keys = await requestResult(attachmentStore.index('conversationId').getAllKeys(id));
  for (const key of keys) attachmentStore.delete(key);
  await transactionDone(transaction);
  database.close();
}

export async function clearHistory(): Promise<void> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction([CONVERSATIONS, ATTACHMENTS], 'readwrite');
  transaction.objectStore(CONVERSATIONS).clear();
  transaction.objectStore(ATTACHMENTS).clear();
  await transactionDone(transaction);
  database.close();
}

export async function historyUsage(): Promise<{ conversations: number; attachments: number; attachmentBytes: number }> {
  const [conversations, attachments] = await Promise.all([listConversations(), allAttachments()]);
  return {
    conversations: conversations.length,
    attachments: attachments.length,
    attachmentBytes: attachments.reduce((sum, attachment) => sum + attachment.size, 0)
  };
}

async function allAttachments(): Promise<AttachmentRecordV1[]> {
  const database = await openHistoryDatabase();
  const transaction = database.transaction(ATTACHMENTS, 'readonly');
  const result = await requestResult(transaction.objectStore(ATTACHMENTS).getAll());
  database.close();
  return result as AttachmentRecordV1[];
}
