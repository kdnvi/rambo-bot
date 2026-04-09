import logger from '../utils/logger.js';
import { Events, EmbedBuilder, MessageFlags } from 'discord.js';
import { updateMatchVote, readMatchVotes, readTournamentData, readPlayers, incrementVoteChange, removePlayerWager, readUserWagers } from '../utils/firebase.js';
import { buildPollEmbedUpdate } from '../utils/helper.js';
import { handleRandomButton } from '../commands/random.js';
import { pickLine } from '../utils/flavor.js';
import { getChannelId } from '../utils/command.js';

export const name = Events.InteractionCreate;
export async function execute(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('random-')) {
      return handleRandomButton(interaction);
    }

    const [matchIdStr, teamId] = interaction.customId.split('|');
    const matchId = parseInt(matchIdStr);

    try {
      await interaction.deferUpdate();

      const [allMatches, players] = await Promise.all([
        readTournamentData('matches'),
        readPlayers(),
      ]);
      const match = allMatches?.find((m) => m.id === matchId);

      if (!match || Date.parse(match.date) < Date.now()) {
        const embed = new EmbedBuilder()
          .setDescription('⏰ Bóng lăn rồi — hết giờ vote!')
          .setColor(0xFEE75C);
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (!players || !players[interaction.user.id]) {
        const embed = new EmbedBuilder()
          .setDescription('❌ `/register` đi rồi mới vote được nha.')
          .setColor(0xED4245);
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      await updateMatchVote(matchId, interaction.user.id, teamId, interaction.message.id);

      const userWagers = await readUserWagers(interaction.user.id);
      if (userWagers[matchId]?.type === 'random') {
        await removePlayerWager(interaction.user.id, matchId);
      }

      const votes = await readMatchVotes(matchId, interaction.message.id);
      const updatedEmbed = buildPollEmbedUpdate(interaction.message.embeds[0], match, votes);

      await interaction.editReply({ embeds: [updatedEmbed] });

      const embed = new EmbedBuilder()
        .setDescription(`✅ Vote của bạn: **${teamId.toUpperCase()}**`)
        .setColor(0x57F287);
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

      const changeCount = await incrementVoteChange(matchId, interaction.user.id);
      const minsUntilKickoff = (Date.parse(match.date) - Date.now()) / 60000;
      const needsChannel = changeCount >= 3 || (minsUntilKickoff <= 5 && minsUntilKickoff > 0);

      let channel = null;
      if (needsChannel) {
        const channelId = await getChannelId();
        channel = await interaction.client.channels.fetch(channelId);
      }

      if (changeCount >= 3 && channel) {
        const drunkLine = await pickLine('drunk');
        const drunkEmbed = new EmbedBuilder()
          .setDescription(`🍺 **${interaction.user}** ${drunkLine} *(${changeCount} lần đổi vote trận #${matchId})*`)
          .setColor(0xE67E22);
        await channel.send({ embeds: [drunkEmbed] });
      }

      if (minsUntilKickoff <= 5 && minsUntilKickoff > 0 && channel) {
        const lastSecLine = await pickLine('last_sec');
        const lateEmbed = new EmbedBuilder()
          .setDescription(`⏰ **${interaction.user}** ${lastSecLine} *(trận #${matchId})*`)
          .setColor(0xFEE75C);
        await channel.send({ embeds: [lateEmbed] });
      }
    } catch (err) {
      logger.error(err);
      await interaction.followUp({ content: '❌ Có lỗi xảy ra với vote của bạn.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      logger.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error executing ${interaction.commandName}`);
      logger.error(error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Có lỗi xảy ra.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }

    return;
  }
}
