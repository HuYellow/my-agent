import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalSessionRecord } from "@my-agent/protocol";

export function TerminalViewport({ session, output }: { session: TerminalSessionRecord; output: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const renderedOutputRef = useRef("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: session.backend === "pty" && session.status === "open",
      disableStdin: session.status !== "open",
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 4_000,
      theme: document.documentElement.dataset.theme === "dark"
        ? { background: "#181818", foreground: "#ededed", cursor: "#10a37f" }
        : { background: "#fbfbfa", foreground: "#242624", cursor: "#0d8f70" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const resize = () => {
      try {
        fit.fit();
        if (terminal.cols > 0 && terminal.rows > 0 && session.status === "open") {
          void window.myAgent.resizeTerminal({ sessionId: session.id, cols: terminal.cols, rows: terminal.rows });
        }
      } catch {
        // The viewport may be temporarily hidden while tabs switch.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    requestAnimationFrame(resize);
    const dataSubscription = terminal.onData((data) => {
      if (session.status === "open") {
        void window.myAgent.writeTerminal({ sessionId: session.id, input: data });
      }
    });

    return () => {
      dataSubscription.dispose();
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      renderedOutputRef.current = "";
    };
  }, [session.backend, session.id, session.status]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previous = renderedOutputRef.current;
    if (output.startsWith(previous)) {
      terminal.write(output.slice(previous.length));
    } else {
      terminal.reset();
      terminal.write(output);
    }
    renderedOutputRef.current = output;
  }, [output]);

  return <div ref={containerRef} className="terminal-viewport" aria-label="Interactive terminal" />;
}
