export default function TypingIndicator() {
  return (
    <article className="message-row assistant">
      <div className="message-bubble thinking">
        <span className="thinking-label">KILLA esta pensando</span>
        <div className="dots" aria-label="typing indicator">
          <span />
          <span />
          <span />
        </div>
      </div>
    </article>
  );
}
