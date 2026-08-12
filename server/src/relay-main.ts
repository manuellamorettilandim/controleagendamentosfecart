import { RelayServer, relayOptionsFromEnvironment } from "./relay.js";

const relay = new RelayServer(relayOptionsFromEnvironment());
await relay.listen();

const address = relay.address();
const port = typeof address === "object" && address ? address.port : process.env.PORT || "unknown";
console.log(`Codex relay listening on port ${port}.`);

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
