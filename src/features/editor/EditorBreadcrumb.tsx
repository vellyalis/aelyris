import { memo } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./EditorBreadcrumb.module.css";

interface EditorBreadcrumbProps {
  filePath: string;
  projectPath?: string;
}

export const EditorBreadcrumb = memo(function EditorBreadcrumb({ filePath, projectPath }: EditorBreadcrumbProps) {
  const relative = projectPath ? filePath.replace(projectPath + "/", "") : filePath;
  const segments = relative.split("/").filter(Boolean);

  return (
    <div className={styles.breadcrumb}>
      {segments.map((seg, i) => (
        <span key={i} className={i === segments.length - 1 ? styles.active : styles.segment}>
          {i > 0 && <ChevronRight size={10} className={styles.sep} />}
          {seg}
        </span>
      ))}
    </div>
  );
});
