export interface PaneEntry {
  terminal_id: string;
  short_id?: number;
  name: string;
  role: string;
  shell_type: string;
  cwd: string;
}
