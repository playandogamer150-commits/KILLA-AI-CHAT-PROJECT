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
  activeTools?: string[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export type ReasoningTraceStepStatus = "pending" | "active" | "done";

export type ReasoningTraceStep = {
  id: string;
  label: string;
  status: ReasoningTraceStepStatus;
  note?: string;
};

export type ReasoningTraceSource = {
  title: string;
  url?: string;
};

export type ReasoningTrace = {
  mode: "think" | "deepsearch" | "hybrid";
  title: string;
  steps: ReasoningTraceStep[];
  optimizer?: {
    label: string;
  };
  optimizedQueries?: string[];
  queries?: string[];
  sources?: ReasoningTraceSource[];
};
