import { create } from "zustand";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  description?: string;
  action?: ToastAction;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = `toast-${nextId++}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    // Auto-dismiss after 5s
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

// Convenience helpers
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().add({ type: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().add({ type: "error", title, description }),
  info: (title: string, description?: string) =>
    useToastStore.getState().add({ type: "info", title, description }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().add({ type: "warning", title, description }),
};
