# Verification scripts

Each drives the real running app and asserts on what actually happened, rather than
mocking. Start both servers first (`bun run dev`), then:

```bash
ADMIN_PASSWORD=<the password the API printed> bun scripts/verify/auth.mjs
ADMIN_PASSWORD=<...> bun scripts/verify/pos.mjs        # card-present sale, end to end
ADMIN_PASSWORD=<...> bun scripts/verify/admin.mjs      # every admin page, in a browser
bun scripts/verify/lan.mjs                             # LAN transport, incl. split frames
```

`lan.mjs` spins up its own fake terminal, so it needs no hardware and no servers.
