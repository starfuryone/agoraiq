[0;1;32m●[0m caddy.service - Caddy
     Loaded: loaded (]8;;file://racknerd-41749bc/usr/lib/systemd/system/caddy.service/usr/lib/systemd/system/caddy.service]8;;; [0;1;32menabled[0m; preset: [0;1;32menabled[0m)
     Active: [0;1;32mactive (running)[0m since Thu 2026-02-19 19:17:59 UTC; 4ms ago
       Docs: ]8;;https://caddyserver.com/docs/https://caddyserver.com/docs/]8;;
   Main PID: 2743668 (caddy)
      Tasks: 17 (limit: 75995)
     Memory: 12.3M (peak: 13.4M)
        CPU: 37ms
     CGroup: /system.slice/caddy.service
             └─[0;38;5;245m2743668 /usr/bin/caddy run --environ --config /etc/caddy/Caddyfile[0m

Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"info","ts":1771528679.7432091,"logger":"http.log","msg":"server running","name":"srv0","protocols":["h1","h2","h3"]}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"warn","ts":1771528679.7432446,"logger":"http","msg":"HTTP/2 skipped because it requires TLS","network":"tcp","addr":":80"}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"warn","ts":1771528679.743249,"logger":"http","msg":"HTTP/3 skipped because it requires TLS","network":"tcp","addr":":80"}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"info","ts":1771528679.7432523,"logger":"http.log","msg":"server running","name":"remaining_auto_https_redirects","protocols":["h1","h2","h3"]}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"info","ts":1771528679.7432563,"logger":"http","msg":"enabling automatic TLS certificate management","domains":["agoraiq.net","www.agoraiq.net","app.agoraiq.net"]}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"info","ts":1771528679.7436798,"logger":"tls","msg":"storage cleaning happened too recently; skipping for now","storage":"FileStorage:/var/lib/caddy/.local/share/caddy","instance":"1d544a4f-f518-4064-bfd5-116c42e660b5","try_again":1771615079.743676,"try_again_in":86399.999999799}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"info","ts":1771528679.743723,"logger":"tls","msg":"finished cleaning storage units"}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"info","ts":1771528679.744247,"msg":"autosaved config (load with --resume flag)","file":"/var/lib/caddy/.config/caddy/autosave.json"}
Feb 19 19:17:59 racknerd-41749bc caddy[2743668]: {"level":"info","ts":1771528679.744281,"msg":"serving initial configuration"}
Feb 19 19:17:59 racknerd-41749bc systemd[1]: Started caddy.service - Caddy.
