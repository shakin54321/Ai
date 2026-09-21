import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  addRole,
  editOriginalInteractionResponse,
  editDiscordChannelMessage,
  env,
  syncGuildStats,
  timeoutGuildMember,
  getBotUserId,
  getDiscordChannelMessage,
  getGuildChannels,
  getGuildMember,
  getGuildRoles,
  removeRole,
} from "@/lib/discord";
import { verifyDiscordSignature } from "@/lib/discord-signature";
import { generateChitchatAI, type ChitchatAIMessage } from "@/lib/ai";
import {
  buildLevelRolePanel,
  levelFromRoleName,
  levelFromXp,
  readLevelStore,
  xpForLevel,
} from "@/lib/level-system";

export const runtime = "nodejs";
export const maxDuration = 15;

const VERIFY_CHANNEL_NAME = "VERIFY-HERE";

function isVerifyChannelName(name?: string) {
  if (!name) return false;
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized === "VERIFYHERE";
}
const UNVERIFIED_ROLE_NAME = "─.✦ 𐔌 ﾟ.✧ Newbie ✮⋆˙";
const VERIFIED_ROLE_NAME = "─.✦ 𐔌 ﾟ.✧ Members ✮⋆˙";
const VERIFY_BUTTON_ID = "chitchat:verify";

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

  // /ai is owner-only. The dedicated ai-chat channel remains public;
  // normal messages there are handled by the separate AI daemon.
  if (
    interaction.type === 2 &&
    interaction.data?.name === "ai"
  ) {
    if (!isOwner(interaction)) {
      return json({
        type: 4,
        data: {
          embeds: [
            embed(
              "ACCESS RESTRICTED",
              process.env.DISCORD_OWNER_ID
                ? "The /ai command is restricted to the bot owner."
                : "Owner access is not configured yet. Set DISCORD_OWNER_ID in Vercel before using /ai.",
              {color: 0xef4444, footer: "Owner-only command"},
            ),
          ],
          flags: 64,
        },
      });
    }

    const promptOption = Array.isArray(interaction.data?.options)
      ? interaction.data.options.find(
          (option: any) => option?.name === "prompt" && option?.type === 3,
        )
      : null;
    const prompt =
      typeof promptOption?.value === "string" ? promptOption.value.trim() : "";

    if (!prompt) {
      return json({
        type: 4,
        data: {
          embeds: [
            embed(
              "CHITCHAT AI",
              "Please provide a question or message after `/ai`.",
              {color: 0xef4444, footer: "Example: /ai prompt: Hello"},
            ),
          ],
          flags: 64,
        },
      });
    }

    const response = json({type: 5});

    after(async () => {
      try {
        const messages: ChitchatAIMessage[] = [
          {
            role: "user",
            content: prompt,
          },
        ];
        const answer = await generateChitchatAI(messages);
        const safeAnswer = answer.length > 3900
          ? answer.slice(0, 3897) + "..."
          : answer;

        await editOriginalInteractionResponse(applicationId, interaction.token, {
          embeds: [
            embed("✦ CHITCHAT AI", safeAnswer, {
              color: 0xa855f7,
              footer: "CHITCHAT • AI Assistant",
            }),
          ],
        });
      } catch (error) {
        await editOriginalInteractionResponse(applicationId, interaction.token, {
          embeds: [
            embed(
              "CHITCHAT AI • ERROR",
              error instanceof Error
                ? error.message.slice(0, 3900)
                : "The AI could not generate a response right now.",
              {color: 0xef4444, footer: "CHITCHAT • AI Assistant"},
            ),
          ],
        }).catch(() => {});
      }
    });

    return response;
  }

  // /leaderboard is public.
  if (interaction.type === 2 && interaction.data?.name === "leaderboard") {
    try {
      const stored = await readLevelStore(guildId);
      const sorted = [...stored.users.values()]
        .sort(
          (a, b) =>
            b.xp - a.xp ||
            b.messages - a.messages ||
            a.userId.localeCompare(b.userId),
        )
        .slice(0, 10);

      const description = sorted.length
        ? sorted.map((user, index) => {
            const level = levelFromXp(user.xp);
            return `**#${index + 1}** <@${user.userId}> — Level **${level}** • **${user.xp.toLocaleString("en-US")} XP**`;
          }).join("\n")
        : "No XP has been earned yet. Start chatting to appear here.";

      return json({
        type: 4,
        data: {
          embeds: [{
            title: "LIVE LEADERBOARD",
            description,
            color: 0xa855f7,
            footer: {text: "CHITCHAT • XP Leaderboard"},
          }],
        },
      });
    } catch (error) {
      return json({
        type: 4,
        data: {
          embeds: [embed(
            "LEADERBOARD UNAVAILABLE",
            error instanceof Error ? error.message : "The XP leaderboard is unavailable right now.",
            {color: 0xef4444, footer: "CHITCHAT • Level System"},
          )],
          flags: 64,
        },
      });
    }
  }

  // All slash commands are owner-only. /verify is also owner-only:
  // non-owners are redirected to the public verification channel button.
  if (interaction.type === 2) {    const commandName = interaction.data?.name;

    if (commandName === "verify" && !isOwner(interaction)) {
      try {
        const channels = await getGuildChannels(guildId);
        const verifyChannel = channels.find(
          (channel) => isVerifyChannelName(channel.name),
        );

        if (verifyChannel) {
          return json({
            type:4,
            data:{
              embeds:[embed(
                "USE THE VERIFICATION BUTTON",
                `Please go to <#${verifyChannel.id}> and click the Verify Account button to continue.`,
                {
                  color:0xf59e0b,
                  footer:"Verification is handled in the verification channel",
                },
              )],
              flags:64,
            },
          });
        }

        return json({
          type:4,
          data:{
            embeds:[embed(
              "VERIFICATION CHANNEL NOT FOUND",
              "The verification channel is currently unavailable. Please contact the server owner.",
              {color:0xef4444, footer:"CHITCHAT verification"},
            )],
            flags:64,
          },
        });
      } catch (error) {
        return json({
          type:4,
          data:{
            embeds:[embed(
              "VERIFICATION CHANNEL ERROR",
              error instanceof Error ? error.message : "Unable to locate the verification channel.",
              {color:0xef4444, footer:"CHITCHAT verification"},
            )],
            flags:64,
          },
        });
      }
    }

    if (!isOwner(interaction)) {
      return json({
        type:4,
        data:{
          embeds:[embed(
            "ACCESS RESTRICTED",
            process.env.DISCORD_OWNER_ID
              ? "This command is restricted to the bot owner.\\n\\nYour account is not authorized to run this command."
              : "Owner access is not configured yet. Set DISCORD_OWNER_ID in Vercel before using management commands.",
            {color:0xef4444, footer:"Owner-only command"},
          )],
          flags:64,
        },
      });
    }
  }

  // /mute — owner-only member timeout.
  if (interaction.type === 2 && interaction.data?.name === "mute") {
    const options = Array.isArray(interaction.data?.options) ? interaction.data.options : [];

    const userOption = options.find((option: any) => option?.name === "user" && option?.type === 6);
    const timeOption = options.find((option: any) => option?.name === "time" && option?.type === 3);
    const reasonOption = options.find((option: any) => option?.name === "reason" && option?.type === 3);

    const targetUserId = typeof userOption?.value === "string" ? userOption.value : "";
    const timeValue = typeof timeOption?.value === "string" ? timeOption.value : "";
    const reason = typeof reasonOption?.value === "string" && reasonOption.value.trim()
      ? reasonOption.value.trim()
      : "Muted for breaking rules";

    const muteDurations: Record<string, {label: string; seconds: number}> = {
      "1m": {label: "1 minute", seconds: 60},
      "5m": {label: "5 minutes", seconds: 5 * 60},
      "10m": {label: "10 minutes", seconds: 10 * 60},
      "30m": {label: "30 minutes", seconds: 30 * 60},
      "1h": {label: "1 hour", seconds: 60 * 60},
      "6h": {label: "6 hours", seconds: 6 * 60 * 60},
      "12h": {label: "12 hours", seconds: 12 * 60 * 60},
      "1d": {label: "1 day", seconds: 24 * 60 * 60},
      "7d": {label: "7 days", seconds: 7 * 24 * 60 * 60},
      "28d": {label: "28 days", seconds: 28 * 24 * 60 * 60},
    };

    const duration = muteDurations[timeValue];

    if (!targetUserId || !duration) {
      return json({
        type: 4,
        data: {
          embeds: [embed("MUTE FAILED", "Select a server member and a valid mute duration.", {color: 0xef4444, footer: "CHITCHAT • Moderation"})],
          flags: 64,
        },
      });
    }

    try {
      await getGuildMember(guildId, targetUserId);
      await timeoutGuildMember(guildId, targetUserId, duration.seconds, reason);

      return json({
        type: 4,
        data: {
          embeds: [embed("MEMBER MUTED", "<@" + targetUserId + "> has been muted for **" + duration.label + "**.\n\nReason: " + reason, {color: 0xa855f7, footer: "CHITCHAT • Moderation"})],
          allowed_mentions: {users: []},
        },
      });
    } catch (error) {
      return json({
        type: 4,
        data: {
          embeds: [embed(
            "MUTE FAILED",
            (error instanceof Error ? error.message : "The member could not be muted.") + "\n\nMake sure the bot has the **Timeout Members** permission and its highest role is above the target member's highest role.",
            {color: 0xef4444, footer: "CHITCHAT • Moderation"},
          )],
          flags: 64,
        },
      });
    }
  }
  // Message context command: Apps → Approved
  if (
    interaction.type === 2 &&
    interaction.data?.type === 3 &&
    interaction.data?.name === "Approved"
  ) {
    if (!isOwner(interaction)) {
      return json({
        type: 4,
        data: {
          embeds: [
            embed(
              "ACCESS RESTRICTED",
              "Only the CHITCHAT server owner can approve donation log entries.",
              {color: 0xef4444, footer: "Owner-only donation action"},
            ),
          ],
          flags: 64,
        },
      });
    }

    const targetMessageId = interaction.data?.target_id;
    const donationLogChannelId = await (async () => {
      const channels = await getGuildChannels(guildId);
      const match = channels.find((channel) => {
        const normalized = (channel.name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        return normalized.includes("DONATION") && normalized.includes("LOG");
      });
      return match?.id ?? null;
    })();

    try {
      if (!targetMessageId) {
        throw new Error("No donation message was selected.");
      }

      if (!donationLogChannelId || interaction.channel_id !== donationLogChannelId) {
        throw new Error("Please use Approved on a message inside the donation log channel.");
      }

      const message = await getDiscordChannelMessage(donationLogChannelId, targetMessageId);
      const botUserId = await getBotUserId();
      const donationEmbed = message.embeds?.[0];
      const title = typeof donationEmbed?.title === "string" ? donationEmbed.title : "";

      if (message.author?.id !== botUserId || !title.includes("DONATION")) {
        throw new Error("That message is not a valid donation log entry.");
      }

      if (title.includes("APPROVED")) {
        return json({
          type:4,
          data:{
            embeds:[embed("ALREADY APPROVED","This donation has already been marked as approved.",{color:0x22c55e, footer:"CHITCHAT • Donation review"})],
            flags:64,
          },
        });
      }

      if (!title.includes("PENDING REVIEW")) {
        throw new Error("Only pending donation entries can be approved.");
      }

      const approvedAt = new Intl.DateTimeFormat("en-BD", {
        timeZone: "Asia/Dhaka",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date());
      const approver =
        interaction.member?.user?.global_name ??
        interaction.member?.user?.username ??
        interaction.user?.global_name ??
        interaction.user?.username ??
        "Owner";

      const currentFields = Array.isArray(donationEmbed.fields) ? donationEmbed.fields : [];
      const fieldsWithoutStatus = currentFields.filter(
        (field: any) => field?.name !== "STATUS" && field?.name !== "APPROVED BY",
      );

      await editDiscordChannelMessage(donationLogChannelId, targetMessageId, {
        embeds: [{
          ...donationEmbed,
          title: "DONATION • APPROVED",
          description: "This donation was manually reviewed and approved by the server owner.",
          color: 0x22c55e,
          fields: [
            ...fieldsWithoutStatus,
            {name: "STATUS", value: "✅ APPROVED", inline: true},
            {name: "APPROVED BY", value: approver, inline: true},
          ],
          footer: {text: `CHITCHAT • Donation approved • ${approvedAt}`},
        }],
      });

      return json({
        type:4,
        data:{
          embeds:[embed("DONATION APPROVED","The selected donation log has been marked as approved.",{color:0x22c55e, footer:`Approved by ${approver}`})],
          flags:64,
        },
      });
    } catch (error) {
      return json({
        type:4,
        data:{
          embeds:[embed("APPROVAL FAILED",error instanceof Error ? error.message : "Unknown error",{color:0xef4444, footer:"Donation review"})],
          flags:64,
        },
      });
    }
  }

  // Level role center pagination and role claiming.
  if (interaction.type === 3 && typeof interaction.data?.custom_id === "string") {
    const customId = interaction.data.custom_id as string;

    if (customId.startsWith("chitchat:level-page:")) {
      const response = json({type: 6});

      after(async () => {
        try {
          const channels = await getGuildChannels(guildId);
          const getRoleChannel = channels.find((channel) =>
            (channel.name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") ===
            "GETROLE",
          );

          if (!getRoleChannel || interaction.channel_id !== getRoleChannel.id) {
            throw new Error("Use the level role buttons inside the level role center.");
          }

          const pageValue = customId.slice("chitchat:level-page:".length);
          const page = Number(pageValue);
          if (!Number.isInteger(page) || page < 0 || page > 4) {
            throw new Error("That level page is not valid.");
          }

          const roles = await getGuildRoles(guildId);
          const levelRoles = roles
            .map((role) => ({level: levelFromRoleName(role.name), id: role.id}))
            .filter((role) => role.level >= 1 && role.level <= 100)
            .sort((a, b) => a.level - b.level);

          await editOriginalInteractionResponse(
            applicationId,
            interaction.token,
            buildLevelRolePanel(page, levelRoles),
          );
        } catch (error) {
          await editOriginalInteractionResponse(
            applicationId,
            interaction.token,
            {
              embeds: [embed(
                "LEVEL PANEL ERROR",
                error instanceof Error ? error.message : "The level role panel could not be updated.",
                {color: 0xef4444, footer: "CHITCHAT • Level System"},
              )],
            },
          ).catch(() => {});
        }
      });

      return response;
    }

    if (customId.startsWith("chitchat:level-claim:")) {
      const roleId = customId.slice("chitchat:level-claim:".length);
      const userId = getInteractionUserId(interaction);

      if (!userId || !roleId) {
        return json({
          type: 4,
          data: {
            embeds: [embed("ROLE CLAIM FAILED", "Your Discord account could not be identified.", {color: 0xef4444})],
            flags: 64,
          },
        });
      }

      // Defer the ephemeral response immediately; role checks and Discord REST
      // calls can take longer than Discord's 3-second initial response window.
      const response = json({type: 5, data: {flags: 64}});

      after(async () => {
        try {
          const channels = await getGuildChannels(guildId);
          const getRoleChannel = channels.find((channel) =>
            (channel.name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") ===
            "GETROLE",
          );

          if (!getRoleChannel || interaction.channel_id !== getRoleChannel.id) {
            throw new Error("Use the buttons inside the level role center.");
          }

          const roles = await getGuildRoles(guildId);
          const targetRole = roles.find((role) => role.id === roleId);
          const targetLevel = levelFromRoleName(targetRole?.name);

          if (!targetRole || targetLevel < 1 || targetLevel > 100) {
            throw new Error("That is not a valid CHITCHAT level role.");
          }

          const stored = await readLevelStore(guildId);
          const user = stored.users.get(userId) ?? {
            userId,
            xp: 0,
            messages: 0,
            displayName: "Member",
            avatar: null,
          };
          const currentLevel = levelFromXp(user.xp);

          if (currentLevel < targetLevel) {
            throw new Error(
              `You need **${xpForLevel(targetLevel).toLocaleString("en-US")} XP** to claim this role.`,
            );
          }

          if (currentLevel !== targetLevel) {
            throw new Error(
              `Your current level is **Level ${currentLevel}**. Claim your current level role instead.`,
            );
          }

          const botUserId = await getBotUserId();
          const botMember = await getGuildMember(guildId, botUserId);
          const botRoleIds: string[] = botMember.roles ?? [];
          const botTopRolePosition = Math.max(
            0,
            ...roles
              .filter((role) => botRoleIds.includes(role.id))
              .map((role) => role.position),
          );

          if (targetRole.position >= botTopRolePosition) {
            throw new Error("The bot's highest role must be above the level roles.");
          }

          const member = await getGuildMember(guildId, userId);
          const currentRoleIds: string[] = member.roles ?? [];
          const existingLevelRoles = roles.filter(
            (role) => {
              const level = levelFromRoleName(role.name);
              return level >= 1 && level <= 100;
            },
          );

          for (const role of existingLevelRoles) {
            if (role.id !== targetRole.id && currentRoleIds.includes(role.id)) {
              await removeRole(guildId, userId, role.id);
            }
          }

          if (!currentRoleIds.includes(targetRole.id)) {
            await addRole(guildId, userId, targetRole.id);
          }

          await editOriginalInteractionResponse(
            applicationId,
            interaction.token,
            {
              embeds: [embed(
                "LEVEL ROLE CLAIMED",
                `You claimed <@&${targetRole.id}> for **Level ${currentLevel}**.`,
                {color: targetRole.color ?? 0xa855f7, footer: "CHITCHAT • Level System"},
              )],
              allowed_mentions: {roles: []},
            },
          );
        } catch (error) {
          await editOriginalInteractionResponse(
            applicationId,
            interaction.token,
            {
              embeds: [embed(
                "ROLE CLAIM FAILED",
                error instanceof Error ? error.message : "The level role could not be claimed.",
                {color: 0xef4444, footer: "CHITCHAT • Level System"},
              )],
            },
          ).catch(() => {});
        }
      });

      return response;
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
            author:{
              name:"✦ CHITCHAT",
            },
            title:"Verification Center",
            description:"Welcome to the server.\n\nSecure your account to unlock full access and continue.",
            color:0x8b5cf6,
            fields:[
              {
                name:"◈ SECURE ACCESS",
                value:"Your Discord account will be verified directly through this server.\nNo extra steps are required.",
                inline:false,
              },
              {
                name:"◈ AFTER VERIFICATION",
                value:"Your server access will be updated automatically once verification is complete.",
                inline:false,
              },
            ],
            footer:{
              text:"CHITCHAT  •  Verification Center",
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
          embeds:[{
            author:{
              name:"✦ CHITCHAT",
            },
            title:"LIVE SERVER STATUS",
            description:"The server statistics have been refreshed and are now up to date.",
            color:0xa855f7,
            fields:[
              {
                name:"👥 MEMBERS",
                value:`**${result.memberCount}** members`,
                inline:true,
              },
              {
                name:"🟢 ONLINE",
                value:`**${result.onlineCount ?? "N/A"}** online`,
                inline:true,
              },
            ],
            footer:{
              text:"CHITCHAT  •  Live server statistics",
            },
          }],
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
        embeds:[embed(
          "VERIFICATION IN PROGRESS",
          "Connecting to the verification system.\n\nPlease keep this message open while your access is being checked.",
          {color:0x3b82f6, footer:"CHITCHAT • Verification system"},
        )],
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
          throw new Error("The bot's highest role is not above the Members role. Move the bot role above the verification roles.");
        }

        if (unverified && unverified.position >= botTopRolePosition) {
          throw new Error("The bot's highest role is not above the Newbie role. Move the bot role above the verification roles.");
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
        // Show a live processing animation while the verification work is running.
        const frames = [
          {title:"VERIFYING ·", description:"Checking your Discord account.\n\nVerification is in progress.", color:0x3b82f6},
          {title:"VERIFYING ··", description:"Checking your server access.\n\nVerification is in progress.", color:0x6366f1},
          {title:"VERIFYING ···", description:"Finalizing your verification.\n\nAlmost there.", color:0x8b5cf6},
          {title:"VERIFYING ·", description:"Confirming access permissions.\n\nPlease keep this message open.", color:0x6366f1},
          {title:"VERIFYING ··", description:"Applying your server access.\n\nOne last check.", color:0x8b5cf6},
          {title:"VERIFYING ···", description:"Completing verification.\n\nYour access is being unlocked.", color:0x3b82f6},
        ];

        const startedAt = Date.now();
        for (const [index, frame] of frames.entries()) {
          await editOriginalInteractionResponse(applicationId, token, {
            embeds:[embed(frame.title, frame.description, {color:frame.color, footer:"CHITCHAT • Verification system"})],
          }).catch(() => {});

          if (index < frames.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 850));
          }
        }

        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, 6500 - elapsed);
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }
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
