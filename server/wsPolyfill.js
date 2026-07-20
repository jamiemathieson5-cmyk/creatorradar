/**
 * Chrome CDP needs a WebSocket constructor.
 * Node 22+ provides globalThis.WebSocket; Node 20 Docker does not.
 * Prefer global, then the `ws` package (installed via package.json).
 */
if (typeof globalThis.WebSocket === "undefined") {
  try {
    // eslint-disable-next-line global-require
    const WS = require("ws");
    globalThis.WebSocket = WS;
  } catch (error) {
    console.error(
      "[wsPolyfill] WebSocket unavailable — install dependency `ws` for Node 20:",
      error.message
    );
  }
}

module.exports = globalThis.WebSocket;
