// Philips Hue sink — NOT ACTIVE YET. This file documents the planned integration so the rest of the
// app doesn't need to change when it lands. See ARCHITECTURE.md, "Philips Hue".
//
// Why a relay: music-synced Hue uses the Hue Entertainment API, which streams colour frames over
// DTLS/UDP to the bridge at 25-50 Hz. Browsers can't open DTLS/UDP sockets, and the bridge lives on
// the brother's LAN while this server lives elsewhere. So a tiny "hue relay" process runs on the
// LAN (e.g. a Raspberry Pi or the HTPC), the browser streams fixture colours to it over a local
// WebSocket, and the relay forwards them to the bridge's entertainment area.
//
//   LightRig -> HueSink (browser) --ws://relay.local:7070--> hue-relay --DTLS/UDP 2100--> Hue bridge
//
// The relay protocol is deliberately trivial: one JSON message per frame.
//   { "type": "frame", "t": 12.345, "lights": [{ "id": "hue-tv", "rgb": [0.1, 0.4, 0.9] }, ...] }
// The relay maps fixture ids to entertainment channel ids from its own config, applies gamma and
// brightness limits, and keeps the DTLS session alive between songs.
//
// Note for when this is built: Chrome gates requests from a public site to local-network addresses
// behind a "Local Network Access" permission prompt, so the first connection will ask the user once.

export class HueSink {
  constructor({ url, maxFps = 30 } = {}) {
    this.url = url;
    this.minInterval = 1000 / maxFps;
    this.last = 0;
    this.ws = null;
  }

  connect() {
    if (!this.url) return;
    this.ws = new WebSocket(this.url);
    this.ws.onclose = () => setTimeout(() => this.connect(), 3000);
  }

  render(fixtures) {
    const now = performance.now();
    if (!this.ws || this.ws.readyState !== 1 || now - this.last < this.minInterval) return;
    this.last = now;
    this.ws.send(JSON.stringify({
      type: 'frame',
      t: now / 1000,
      lights: fixtures.map((f) => ({ id: f.id, rgb: f.color.map((v) => Math.min(1, Math.max(0, v))) })),
    }));
  }
}
