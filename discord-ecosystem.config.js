module.exports = {
  apps: [{
    name: "agoraiq-discord",
    script: "/opt/agoraiq/packages/listener/discord_listener.py",
    interpreter: "python3",
    env: {
      DISCORD_BOT_TOKEN: "MTQ3NjI0MDI4OTk1NzAxOTczMg.GvbyUK.tDV0-KDpcwzIp0Dtx4_aCjUtNJJS1dHhiQIJdw",
      DISCORD_CHANNELS: "1081439940560297998:discord-biz1-general:6015d97ee57c3f7b7d6c090f23fca02bce6ebce93f15e7ace12a64fa8796fc9d",
      AGORAIQ_API_URL: "http://127.0.0.1:4000/api/v1/providers"
    }
  }]
};
