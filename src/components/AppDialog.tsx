import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className: string;
  labelledBy: string;
  open: boolean;
  preventClose?: boolean;
  onClose: () => void;
};

export function AppDialog({ children, className, labelledBy, open, preventClose, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!preventClose) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !preventClose) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
