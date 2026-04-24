import styles from "./EditorPanel.module.css";

function buildCommentPrompt(
  filePath: string | null,
  lineNumber: number,
  content: string | null,
  comment: string,
): string {
  const lines = (content ?? "").split("\n");
  const context = lines.slice(Math.max(0, lineNumber - 3), lineNumber + 2).join("\n");
  return `File: ${filePath}, Line ${lineNumber}\n\nContext:\n${context}\n\nFeedback: ${comment}\n\nPlease fix this issue.`;
}

interface DiffCommentInputProps {
  filePath: string | null;
  lineNumber: number;
  content: string | null;
  commentText: string;
  onChangeText: (t: string) => void;
  onSubmit: (prompt: string, comment: string) => void;
  onCancel: () => void;
}

export function DiffCommentInput({
  filePath,
  lineNumber,
  content,
  commentText,
  onChangeText,
  onSubmit,
  onCancel,
}: DiffCommentInputProps) {
  const submit = () => {
    if (!commentText.trim()) return;
    onSubmit(buildCommentPrompt(filePath, lineNumber, content, commentText.trim()), commentText.trim());
  };
  return (
    <div className={styles.commentOverlay}>
      <div className={styles.commentBox}>
        <span className={styles.commentLabel}>Line {lineNumber} — feedback for agent:</span>
        <textarea
          autoFocus
          className={styles.commentInput}
          placeholder="Describe what to fix..."
          value={commentText}
          onChange={(e) => onChangeText(e.target.value)}
          rows={2}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className={styles.commentActions}>
          <button className={styles.commentSend} onClick={submit}>
            Send to Agent (Ctrl+Enter)
          </button>
          <button className={styles.commentCancel} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
