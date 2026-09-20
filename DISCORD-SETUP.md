# CHITCHAT AI — Discord Verification

The Vercel app provides the Discord Interactions endpoint for the CHITCHAT verification flow.

## Required Vercel environment variables

- `DISCORD_CLIENT_ID` = `1551174318145273916`
- `DISCORD_BOT_TOKEN` = your private bot token (never commit or share it)
- `DISCORD_PUBLIC_KEY` = the application's Public Key from Discord Developer Portal
- `DISCORD_SETUP_SECRET` = any private setup password you choose

## Discord setup

1. Deploy this project to Vercel.
2. In Discord Developer Portal → CHITCHAT AI → General Information, set **Interactions Endpoint URL** to:
   `https://<your-vercel-domain>/api/discord/interactions`
3. Visit:
   `https://<your-vercel-domain>/api/discord/setup?key=<DISCORD_SETUP_SECRET>`
   This registers the global `/verify` command.
4. In `#VERIFY-HERE`, run `/verify`.
5. The verification button removes `🔒 UNVERIFIED` and adds `✅ VERIFIED`.

The handler intentionally accepts the verification interaction only in a channel named `VERIFY-HERE`.

## Important role requirement

The bot needs **Manage Roles**, and its highest role must be above `✅ VERIFIED` and `🔒 UNVERIFIED` in the server hierarchy.

## Security

Never put the bot token, public key, or setup secret into GitHub source files.
