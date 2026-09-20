import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  addRole,
  editOriginalInteractionResponse,
  env,
  syncGuildStats,
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

const PUBLIC_COMMANDS = new Set(["verify"]);

function getInteractionUserId(interaction: any): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function isOwner(interaction: any): boolean {
  const ownerId = process.env.DISCORD_OWNER_ID?.trim();
  const userId = getInteractionUserId(interaction);
  return Boolean(ownerId && userId && userId === ownerId);
}

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function embed(
  title: string,
  description: string,
  options: {
    color?: number;
    fields?: Array<{name: string; value: string; inline?: boolean}>;
    footer?: string;
  } = {},
) {
  return {
    title,
    description,
    color: options.color ?? 0x8b5cf6,
    fields: options.fields,
    footer: options.footer ? {text: options.footer} : undefined,
  };
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
      data:{
      embeds:[embed("CHITCHAT","This command is available only inside the CHITCHAT server.",{footer:"Server access required"})],
      flags:64,
    },
    });
  }

  // All slash commands are owner-only except /verify.
  // This is enforced in code so Administrator permissions alone do not grant access.
  if (interaction.type === 2) {
    const commandName = interaction.data?.name;
    if (!PUBLIC_COMMANDS.has(commandName) && !isOwner(interaction)) {
      return json({
        type: 4,
        data: {
          // Keep owner access enforced in code; this is only the presentation layer.
          embeds:[embed(
            "ACCESS RESTRICTED",
            process.env.DISCORD_OWNER_ID
              ? "This command is restricted to the bot owner.\\n\\nYour account is not authorized to run this command."
              : "Owner access is not configured yet. Set DISCORD_OWNER_ID in Vercel before using management commands.",
            {color:0xef4444, footer:"Owner-only command"},
          )],
          flags: 64,
        },
      });
    }
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
            embeds:[embed(
              "USE THE VERIFICATION CHANNEL",
              "Please use the #VERIFY-HERE channel to start verification.",
              {color:0xf59e0b, footer:"Verification channel required"},
            )],
            flags:64,
          },
        });
      }

      return json({
        type:4,
        data:{
          embeds:[{
            title:"CHITCHAT",
            description:"## Server Verification\\n\\nWelcome to the server.\\n\\nVerify your Discord account to unlock full access and continue.",
            color:0x8b5cf6,
            fields:[
              {
                name:"SECURE ACCESS",
                value:"Verification is quick and handled directly through Discord.",
                inline:false,
              },
              {
                name:"WHAT HAPPENS NEXT",
                value:"Complete verification below and your server access will be updated automatically.",
                inline:false,
              },
            ],
            footer:{
              text:"CHITCHAT • Secure verification",
            },
          }],
          components:[{
            type:1,
            components:[{
              type:2,
              style:1,
              label:"Verify Account",
              custom_id:VERIFY_BUTTON_ID,
            }],
          }],
        },
      });
    } catch (error) {
      return json({
        type:4,
        data:{
          embeds:[embed(
            "VERIFICATION SETUP ERROR",
            error instanceof Error ? error.message : "Unknown error",
            {color:0xef4444, footer:"Please contact the server owner"},
          )],
          flags:64,
        },
      });
    }
  }

  // /stats — administrator-only manual refresh
  if (
    interaction.type === 2 &&
    interaction.data?.name === "stats"
  ) {
    try {
      const result = await syncGuildStats(guildId);
      return json({
        type: 4,
        data: {
          embeds:[embed(
            "SERVER STATS UPDATED",
            "The live server statistics have been refreshed successfully.",
            {
              fields:[
                {name:"Members", value:String(result.memberCount), inline:true},
                {name:"Online", value:String(result.onlineCount ?? "N/A"), inline:true},
              ],
              footer:"CHITCHAT live statistics",
            },
          )],
          flags:64,
        },
      });
    } catch (error) {
      return json({
        type: 4,
        data: {
          embeds:[embed(
            "STATS UPDATE FAILED",
            error instanceof Error ? error.message : "Unknown error",
            {color:0xef4444, footer:"No server settings were changed"},
          )],
          flags: 64,
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
        data:{
          embeds:[embed("ACCOUNT NOT FOUND","Discord did not provide enough information to identify your account.",{color:0xef4444})],
          flags:64,
        },
      });
    }

    // Reply instantly; Discord requires interaction acknowledgement within a few seconds.
    const response = json({
      type:4,
      data:{
        embeds:[embed("VERIFICATION IN PROGRESS","Your verification request has been received. Please wait a few seconds.",{color:0x3b82f6, footer:"CHITCHAT verification"})],
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

        // Refresh public server stats whenever a member completes verification.
        await syncGuildStats(guildId).catch(() => {});

        await editOriginalInteractionResponse(applicationId, token, {
          embeds:[embed("VERIFICATION COMPLETE","Your account has been verified and CHITCHAT server access is now unlocked.",{color:0x22c55e, footer:"Welcome to CHITCHAT"})],
          components:[],
        });
      };

      try {
        // 6.5 seconds matches the requested visible processing window without delaying the initial interaction acknowledgement.
        await new Promise((resolve) => setTimeout(resolve, 6500));
        await finish();
      } catch (error) {
        await editOriginalInteractionResponse(applicationId, token, {
          embeds:[embed("VERIFICATION FAILED",error instanceof Error ? error.message : "Unknown error",{color:0xef4444, footer:"No role changes were completed after this failure"})],
          components:[],
        }).catch(() => {});
      }
    });

    return response;
  }

  return json({
    type:4,
    data:{
      embeds:[embed("COMMAND NOT FOUND","The requested command is not available.",{color:0xef4444})],
      flags:64,
    },
  });
}
