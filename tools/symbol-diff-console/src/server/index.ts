import { createApp } from "./app";

const port = Number(process.env.SYMBOL_DIFF_API_PORT ?? process.env.PORT ?? 5174);
const host = process.env.SYMBOL_DIFF_HOST ?? "127.0.0.1";

createApp().listen(port, host, () => {
  console.log(`symbol-diff-console API listening on http://${host}:${port}`);
});
