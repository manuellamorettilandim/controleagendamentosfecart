import { useEffect, useRef } from "react";

export interface LegacyPageProps {
  template: string;
  loadController: () => Promise<void>;
  dispatchReadyEvent?: boolean;
}

export function LegacyPage({ template, loadController, dispatchReadyEvent = false }: LegacyPageProps) {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    let cancelled = false;

    void loadController().then(() => {
      if (!cancelled && dispatchReadyEvent) {
        document.dispatchEvent(new Event("DOMContentLoaded"));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [dispatchReadyEvent, loadController]);

  return <div dangerouslySetInnerHTML={{ __html: template }} />;
}
