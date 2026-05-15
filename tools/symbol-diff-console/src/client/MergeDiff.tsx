import { cpp } from "@codemirror/lang-cpp";
import { MergeView } from "@codemirror/merge";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { SymbolDiff } from "../shared/schema";

type MergeDiffProps = {
  symbol: SymbolDiff | undefined;
};

export function MergeDiff({ symbol }: MergeDiffProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !symbol) return;
    containerRef.current.innerHTML = "";
    const merge = new MergeView({
      a: {
        doc: symbol.left?.text ?? "",
        extensions: [basicSetup, cpp(), EditorView.editable.of(false), EditorView.lineWrapping]
      },
      b: {
        doc: symbol.right?.text ?? "",
        extensions: [basicSetup, cpp(), EditorView.editable.of(false), EditorView.lineWrapping]
      },
      parent: containerRef.current,
      revertControls: "a-to-b"
    });
    return () => {
      merge.destroy();
    };
  }, [symbol?.symbolId]);

  if (!symbol) {
    return <div className="empty-panel">왼쪽에서 심볼을 선택하세요.</div>;
  }

  return <div className="merge-view" ref={containerRef} data-testid="merge-view" />;
}
