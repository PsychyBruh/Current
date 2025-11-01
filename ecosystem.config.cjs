module.exports = {
  apps: [
    {
      name: "current",
      script: "bun",
      args: "start",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      }
    },
    {
      name: "epoxy-server",
      script: "/usr/local/bin/epoxy-server",
      args: "/etc/epoxy-server/config.toml",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G"
    }
  ]
};
