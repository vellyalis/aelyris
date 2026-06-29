import * as Dialog from "@radix-ui/react-dialog";
import pkg from "../../../package.json";
import logoPng from "../../assets/logo.png";
import { PRODUCT_NAME } from "../../shared/constants/product";
import styles from "./AboutDialog.module.css";

const APP_VERSION = pkg.version;

interface AboutDialogProps {
  visible: boolean;
  onClose: () => void;
}

export function AboutDialog({ visible, onClose }: AboutDialogProps) {
  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
          <img src={logoPng} alt="" width={64} height={64} className={styles.logo} />
          <Dialog.Title className={styles.title}>{PRODUCT_NAME}</Dialog.Title>
          <p className={styles.version}>Version {APP_VERSION}</p>
          <p className={styles.desc}>Project-first AI terminal for Windows development</p>
          <div className={styles.info}>
            <div className={styles.row}>
              <span>Framework</span>
              <span>Tauri v2 + React 19</span>
            </div>
            <div className={styles.row}>
              <span>Terminal</span>
              <span>alacritty_terminal + Canvas 2D</span>
            </div>
            <div className={styles.row}>
              <span>Editor</span>
              <span>Monaco Editor</span>
            </div>
            <div className={styles.row}>
              <span>Backend</span>
              <span>Rust + ConPTY</span>
            </div>
            <div className={styles.row}>
              <span>Git</span>
              <span>libgit2 (git2-rs)</span>
            </div>
          </div>
          <Dialog.Close asChild>
            <button type="button" className={styles.closeBtn}>
              Close
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
