type PuterMessage = {
  role: string;
  content: string;
};

type PuterModel = {
  id: string;
  name?: string;
  provider?: string;
};

type PuterChatOptions = {
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
};

type PuterUser = {
  uuid?: string;
  username?: string;
  email?: string;
};

type PuterGlobal = {
  auth: {
    isSignedIn: () => boolean;
    signIn: () => Promise<unknown>;
    signOut?: () => void;
    getUser?: () => Promise<PuterUser>;
  };
  ai: {
    listModels: () => Promise<PuterModel[]>;
    chat: (
      messages: string | PuterMessage | PuterMessage[],
      options?: PuterChatOptions
    ) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

export {};
