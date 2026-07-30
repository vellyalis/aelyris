export interface WorkspaceEditorAreaViewModel {
  activeFile: string;
  openFiles: readonly string[];
  projectPath: string;
  initialLine?: number;
  initialDiffMode: boolean;
}

export interface WorkspaceEditorAreaActions {
  onSelectFile: (filePath: string) => void;
  onCloseFile: (filePath: string) => void | Promise<void>;
  onStartAgent: (prompt: string) => void;
}
