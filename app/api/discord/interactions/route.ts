import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  addRole,
  editOriginalInteractionResponse,
  env,
  getBotUserId,
  getGuildChannels,
  getGuildMember,
  getGuildRoles,
  removeRole,
  verifyDiscordSignature,
} from "@/lib/discord";

export const runtime = "nodejs";
export const maxDuration = 15;

const VERIFY_CHANNEL_NAME = "VERIFY-HERE";

function isVerifyChannelName(name?: string) {
  if (!name) return false;
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized === "VERIFYHERE";
}
const UNVERIFIED_ROLE_NAME = "🔒 UNVERIFIED";
const VERIFIED_ROLE_NAME = "✅ VERIFIED";
const VERIFY_BUTTON_ID = "chitchat:verify";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp || !publicKey) {
    return new NextResponse("Unauthorized", {status:401});
  }

  const body = await request.text();
  if (!verifyDiscordSignature(body, signature, timestamp, publicKey)) {
    return new NextResponse("Unauthorized", {status:401});
  }

  let interaction: any;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new NextResponse("Bad request", {status:400});
  }

  // Discord PING
  if (interaction.type === 1) {
    return json({type: 1});
  }

  const applicationId = interaction.application_id;
  const guildId = interaction.guild_id;
  if (!guildId) {
    return json({
      type:4,
      data:{content:"This command only works inside the CHITCHAT server.",flags:64},
    });
  }

  // /verify
  if (
    interaction.type === 2 &&
    interaction.data?.name === "verify"
  ) {
    try {
      const channels = await getGuildChannels(guildId);
      const verifyChannel = channels.find(
        (channel) => isVerifyChannelName(channel.name),
      );

      if (!verifyChannel || interaction.channel_id !== verifyChannel.id) {
        return json({
          type:4,
          data:{
            content:"Please use **#VERIFY-HERE** to verify your account.",
            flags:64,
          },
        });
      }

      return json({
        type:4,
        data:{
          content:[
            "╭────────────────────────╮",
            "       **CHITCHAT**",
            "     **VERIFICATION**",
            "╰────────────────────────╯",
            "",
            "Welcome to CHITCHAT.",
            "",
            "Click the button below to verify your account and unlock the full server.",
          ].join("\n"),
          components:[{
            type:1,
            components:[{
              type:2,
              style:3,
              label:"VERIFY",
              custom_id:VERIFY_BUTTON_ID,
            }],
          }],
        },
      });
    } catch (error) {
      return json({
        type:4,
        data:{
          content:`Verification setup error: ${error instanceof Error ? error.message : "Unknown error"}`,
          flags:64,
        },
      });
    }
  }

  // VERIFY button
  if (
    interaction.type === 3 &&
    interaction.data?.custom_id === VERIFY_BUTTON_ID
  ) {
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    const token = interaction.token;

    if (!userId) {
      return json({
        type:4,
        data:{content:"Could not identify your Discord account.",flags:64},
      });
    }

    // Reply instantly; Discord requires interaction acknowledgement within a few seconds.
    const response = json({
      type:4,
      data:{
        content:"⏳ **Verification processing...**\nPlease wait a few seconds.",
        flags:64,
      },
    });

    // Continue after the acknowledgement so the user gets the requested processing state.
    after(async () => {
      const finish = async () => {
        const roles = await getGuildRoles(guildId);
        const unverified = roles.find((r) => r.name === UNVERIFIED_ROLE_NAME);
        const verified = roles.find((r) => r.name === VERIFIED_ROLE_NAME);

        if (!verified) throw new Error(`Role not found: ${VERIFIED_ROLE_NAME}`);

        const botUserId = await getBotUserId();
        const botMember = await getGuildMember(guildId, botUserId);
        const botRoleIds: string[] = botMember.roles ?? [];
        const botTopRolePosition = Math.max(
          0,
          ...roles.filter((r) => botRoleIds.includes(r.id)).map((r) => r.position),
        );

        if (verified.position >= botTopRolePosition) {
          throw new Error("The bot's highest role is not above ✅ VERIFIED. Move the bot role above the verification roles.");
        }

        if (unverified && unverified.position >= botTopRolePosition) {
          throw new Error("The bot's highest role is not above 🔒 UNVERIFIED. Move the bot role above the verification roles.");
        }

        const currentMember = await getGuildMember(guildId, userId);
        const currentRoles: string[] = currentMember.roles ?? [];

        if (unverified && currentRoles.includes(unverified.id)) {
          await removeRole(guildId, userId, unverified.id);
        }
        if (!currentRoles.includes(verified.id)) {
          await addRole(guildId, userId, verified.id);
        }

        await editOriginalInteractionResponse(applicationId, token, {
          content:"✅ **Verification successful!**\nYour CHITCHAT server access has been unlocked.",
          components:[],
        });
      };

      try {
        // 6.5 seconds matches the requested visible processing window without delaying the initial interaction acknowledgement.
        await new Promise((resolve) => setTimeout(resolve, 6500));
        await finish();
      } catch (error) {
        await editOriginalInteractionResponse(applicationId, token, {
          content:`❌ Verification could not be completed.\n\n${error instanceof Error ? error.message : "Unknown error"}`,
          components:[],
        }).catch(() => {});
      }
    });

    return response;
  }

  return json({
    type:4,
    data:{content:"Unknown command.",flags:64},
  });
}
