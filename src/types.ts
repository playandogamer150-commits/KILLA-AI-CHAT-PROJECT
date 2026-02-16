export type Role = "assistant" | "user";

export type AttachmentKind = "image" | "video";

export type ChatAttachment = {
  id: string;
  kind: AttachmentKind;
  url: string;
  createdAt: number;
};

export type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  createdAt: number;
  attachments?: ChatAttachment[];
};

export type Tool = {
  id: string;
  label: string;
  icon: string;
};

export type ModelOption = {
  id: string;
  name: string;
  provider?: string;
};

export type ThreadKind = "chat" | "media";

export type ChatThread = {
  id: string;
  title: string;
  kind?: ThreadKind;
  activeTool?: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};
