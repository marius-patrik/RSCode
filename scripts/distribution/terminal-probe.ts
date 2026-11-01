export {};
const port = Number(process.env.CANVAS_PORT);
if (!Number.isInteger(port) || port < 1) throw new Error("Missing CANVAS_PORT");
const marker = "RSCODE_NATIVE_TERMINAL_OK";
const url = `ws://127.0.0.1:${port}/api/terminal/spawn?paneId=distribution-probe&cwd=${encodeURIComponent(process.cwd())}`;
const result = await new Promise<string>((resolve, reject) => {
  const ws = new WebSocket(url);
  let output = "";
  const timeout = setTimeout(() => { ws.close(); reject(new Error(`Terminal timeout: ${output.slice(-500)}`)); }, 12000);
  ws.onopen = () => ws.send(JSON.stringify({ type: "input", data: "printf 'RSCODE_NATIVE_%s\\n' TERMINAL_OK\nexit\n" }));
  ws.onmessage = (event) => {
    output += String(event.data);
    if (output.includes(marker)) {
      clearTimeout(timeout);
      ws.close();
      resolve(output);
    }
  };
  ws.onerror = () => { clearTimeout(timeout); reject(new Error(`Terminal WebSocket failed: ${output}`)); };
  ws.onclose = () => {
    if (!output.includes(marker)) {
      clearTimeout(timeout);
      reject(new Error(`Terminal closed before sentinel: ${output}`));
    }
  };
});
if (!result.includes(marker)) throw new Error("Sentinel missing");
console.log(JSON.stringify({ terminalPty: "PASS" }));
