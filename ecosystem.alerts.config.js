// ─────────────────────────────────────────────────────────────
// ecosystem.alerts.config.js
// PM2 config for the alert engine worker
// Place in /opt/agoraiq/ and run:  pm2 start ecosystem.alerts.config.js
// ─────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name:       'agoraiq-alert-worker',
      script:     'packages/api/dist/lib/alerts/worker.js',
      cwd:        '/opt/agoraiq',
      instances:  1,
      exec_mode:  'fork',
      env: {
        NODE_ENV: 'production',
      },
      env_file:   '/etc/agoraiq.env',
      max_memory_restart: '256M',
      // Restart with backoff on crash
      exp_backoff_restart_delay: 1000,
      max_restarts: 20,
      // Log config
      error_file: '/var/log/agoraiq/alert-worker-error.log',
      out_file:   '/var/log/agoraiq/alert-worker-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
