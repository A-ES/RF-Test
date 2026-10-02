/**
 * Serializers shared by the conversations/messages API routes. Keeping them in
 * one place means the REST shape stays consistent between list, detail and
 * create responses (and is easy to unit test).
 */

export interface AttachmentData {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl?: string | null;
}

export interface MessageWithSender {
  id: string;
  conversationId: string;
  senderId: string;
  isRFTeam: boolean;
  content: string;
  messageType?: string;
  createdAt: Date;
  sender: {
    name: string;
    avatarInitials: string;
    role: string;
    isRFTeam: boolean;
  };
  attachments?: Array<{
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileUrl: string | null;
  }>;
}

export interface ConversationSummaryRow {
  id: string;
  topic: string;
  contextLabel: string;
  rfLead: string;
  status?: string;
  type?: string;
  unread: boolean;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ content: string; createdAt: Date }>;
  participants?: Array<{
    id: string;
    role: string;
    user: { id: string; name: string; avatarInitials: string; role: string } | null;
  }>;
  _count: { messages: number };
}

export interface SerializedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  senderRole: string;
  isRFTeam: boolean;
  content: string;
  messageType: string;
  attachments: AttachmentData[];
  createdAt: Date;
}

function senderRole(message: MessageWithSender): string {
  if (message.sender.isRFTeam) return "RF Operations";
  return message.sender.role === "ADMIN" ? "Admin" : "Member";
}

export function serializeMessage(message: MessageWithSender): SerializedMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: message.sender.name,
    senderInitials: message.sender.avatarInitials,
    senderRole: senderRole(message),
    isRFTeam: message.isRFTeam,
    content: message.content,
    messageType: message.messageType ?? "TEXT",
    attachments: (message.attachments ?? []).map((att) => ({
      id: att.id,
      fileName: att.fileName,
      fileSize: att.fileSize,
      mimeType: att.mimeType,
      fileUrl: att.fileUrl,
    })),
    createdAt: message.createdAt,
  };
}

export function serializeConversationSummary(row: ConversationSummaryRow) {
  const msgs = row.messages ?? [];
  return {
    id: row.id,
    topic: row.topic,
    contextLabel: row.contextLabel,
    rfLead: row.rfLead,
    status: row.status ?? "OPEN",
    type: row.type ?? "TEAM",
    unread: row.unread,
    resolvedAt: row.resolvedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: msgs[0]?.createdAt ?? null,
    lastMessagePreview: msgs[0]?.content ?? null,
    messageCount: row._count?.messages ?? msgs.length,
    participants: (row.participants ?? []).map((p) => ({
      id: p.id,
      role: p.role,
      user: p.user ? {
        id: p.user.id,
        name: p.user.name,
        avatarInitials: p.user.avatarInitials,
        role: p.user.role,
      } : null,
    })),
  };
}
