// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearHistory, createConversation, createMessage, deleteConversation, getConversationAttachments, listConversations, saveAttachment, saveConversation } from '../src/history';

beforeEach(() => clearHistory());

describe('local conversation history', () => {
  it('stores conversations and original attachment blobs, then deletes both', async () => {
    const conversation = createConversation('vision', 'vision-model');
    conversation.messages.push(createMessage('user', 'What is shown?', 'vision-model', ['attachment-1']));
    await saveConversation(conversation);
    await saveAttachment({ id: 'attachment-1', version: 1, conversationId: conversation.id, kind: 'image', name: 'photo.png', mimeType: 'image/png', size: 3, blob: new Blob(['png']), createdAt: Date.now() });
    expect(await listConversations('vision')).toHaveLength(1);
    expect(await getConversationAttachments(conversation.id)).toHaveLength(1);
    await deleteConversation(conversation.id);
    expect(await listConversations('vision')).toHaveLength(0);
    expect(await getConversationAttachments(conversation.id)).toHaveLength(0);
  });
});
