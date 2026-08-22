module.exports = {
  apps: [
    {
      name: "ai-provider-hub",
      script: "dist-server/server.js",
      // Single fork instance — NOT cluster mode:
      //  * The hub keeps a local JSON store + short in-memory TTL caches per
      //    process; cluster workers would serve stale keys/config to some
      //    requests until their cache expires, and both race on hub_store.json.
      //  * Small VPS (1GB RAM / 1-2 vCPU) gains nothing from extra workers —
      //    Node's async IO handles the gateway's concurrent streams fine.
      instances: 1,
      exec_mode: "fork",
      // Safety net for slow leaks on tiny VMs: restart instead of OOM-kill.
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "0.0.0.0",
      },
    },
  ],
};
