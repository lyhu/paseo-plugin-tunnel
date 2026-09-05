// Feed decoded UTF-8 text. Dispatch only complete SSE events, including multiline data.
export function createSseParser(onData) {
  let pending = "";
  let lines = [];
  return (chunk) => {
    pending += chunk;
    let index = pending.indexOf("\n");
    while (index !== -1) {
      const line = pending.slice(0, index).replace(/\r$/, "");
      pending = pending.slice(index + 1);
      if (line === "") {
        if (lines.length) onData(lines.join("\n"));
        lines = [];
      } else if (line === "data" || line.startsWith("data:")) {
        lines.push(line.slice(5).replace(/^ /, ""));
      }
      index = pending.indexOf("\n");
    }
  };
}
