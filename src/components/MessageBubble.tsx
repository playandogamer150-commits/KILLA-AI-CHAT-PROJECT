import type { ChatAttachment, ChatMessage } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";

type MessageBubbleProps = {
  message: ChatMessage;
  onOpenImage?: (url: string) => void;
  typing?: boolean;
};

function Attachment({ item, onOpenImage }: { item: ChatAttachment; onOpenImage?: (url: string) => void }) {
  if (item.kind === "video") {
    return (
      <div className="message-attachment video">
        <video className="message-media" controls preload="metadata" src={item.url} />
      </div>
    );
  }

  return (
    <a
      className="message-attachment image"
      href={item.url}
      title="Abrir imagem"
      onClick={(e) => {
        if (onOpenImage) {
          e.preventDefault();
          onOpenImage(item.url);
        }
      }}
    >
      <img className="message-media" src={item.url} alt="Generated" loading="lazy" />
    </a>
  );
}

export default function MessageBubble({ message, onOpenImage, typing }: MessageBubbleProps) {
  const isTyping = Boolean(typing && message.role === "assistant");

  return (
    <article className={`message-row ${message.role}`}>
      <div className={`message-bubble ${isTyping ? "thinking" : ""}`.trim()}>
        {isTyping ? (
          <>
            <span className="thinking-label">{message.text || "KILLA esta pensando"}</span>
            <div className="dots" aria-label="typing indicator">
              <span />
              <span />
              <span />
            </div>
          </>
        ) : (
          <div className="message-markdown">
            <MarkdownRenderer content={message.text} />
          </div>
        )}

        {!isTyping && message.attachments && message.attachments.length > 0 ? (
          <div className="message-attachments">
            {message.attachments.map((item) => (
              <Attachment key={item.id} item={item} onOpenImage={onOpenImage} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
