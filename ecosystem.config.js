module.exports = {
  apps: [
    { name: 'agoraiq-api',      script: 'packages/api/dist/index.js',      cwd: '/opt/agoraiq', env_file: '/opt/agoraiq/.env' },
    { name: 'agoraiq-discord',  script: 'packages/discord/dist/index.js',  cwd: '/opt/agoraiq', env_file: '/opt/agoraiq/.env' },
    { name: 'agoraiq-listener', script: 'packages/listener/dist/index.js', cwd: '/opt/agoraiq', env_file: '/opt/agoraiq/.env' },
    { name: 'agoraiq-telegram', script: 'packages/telegram/dist/index.js', cwd: '/opt/agoraiq', env_file: '/opt/agoraiq/.env' },
    { name: 'agoraiq-collector', script: 'packages/collector/index.js', cwd: '/opt/agoraiq', env_file: '/opt/agoraiq/.env', env: { LOG_LEVEL: 'info', MAX_PAIRS_PER_EX: '300' } },
    { name: 'agoraiq-tracker',  script: 'packages/tracker/dist/index.js',  cwd: '/opt/agoraiq', env_file: '/opt/agoraiq/.env' },
  ]
}
