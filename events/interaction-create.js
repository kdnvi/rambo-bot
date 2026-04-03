import logger from '../utils/logger.js';
import { Events, EmbedBuilder, MessageFlags } from 'discord.js';
import { updateMatchVote, readMatchVotes, readTournamentData, incrementVoteChange, readTournamentConfig } from '../utils/firebase.js';

const DRUNK_LINES = [
  'can\'t make up their mind... are they okay? 🍺',
  'is switching votes like changing channels 📺',
  'has commitment issues with this match 💔',
  'is sweating bullets over this pick 😰',
  'just changed their vote AGAIN. Indecisive legend.',
  'is having a full existential crisis over this match 🌀',
];

const LAST_SEC_LINES = [
  'just snuck in a last-second vote! Sweaty palms energy. 💦',
  'cutting it REAL close! Did they just wake up? ⏰',
  'voted with seconds to spare. Living on the edge. 🫣',
  'just slid in under the wire. Clutch or reckless? 🎰',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const name = Events.InteractionCreate;
export async function execute(interaction) {
  if (interaction.isButton()) {
    const [matchIdStr, teamId] = interaction.customId.split('|');
    const matchId = parseInt(matchIdStr);

    try {
      const allMatches = (await readTournamentData('matches')).val();
      const match = allMatches?.find((m) => m.id === matchId);

      if (!match || Date.parse(match.date) < Date.now()) {
        const embed = new EmbedBuilder()
          .setDescription('⏰ This match has already started — voting is closed.')
          .setColor(0xFEE75C);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      await updateMatchVote(matchId, interaction.user.id, teamId, interaction.message.id);
      const votes = (await readMatchVotes(matchId, interaction.message.id)).val();
      const voteCount = votes ? Object.keys(votes).length : 0;

      const distribution = { [match.home]: 0, draw: 0, [match.away]: 0 };
      if (votes) {
        for (const v of Object.values(votes)) {
          if (v.vote in distribution) distribution[v.vote]++;
        }
      }
      const pct = (n) => voteCount > 0 ? Math.round((n / voteCount) * 100) : 0;
      const hp = pct(distribution[match.home]);
      const dp = pct(distribution.draw);
      const ap = pct(distribution[match.away]);

      const barText = `${match.home.toUpperCase()} ${hp}%  ·  Draw ${dp}%  ·  ${match.away.toUpperCase()} ${ap}%`;

      const existingEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(existingEmbed)
        .setFooter({ text: `${voteCount} vote(s) cast · Vote below before kickoff!` });

      const descParts = existingEmbed.description.split('\n```');
      const baseDesc = descParts[0];
      updatedEmbed.setDescription(`${baseDesc}\n\n${barText}`);

      await interaction.update({ embeds: [updatedEmbed] });
      const embed = new EmbedBuilder()
        .setDescription(`✅ Your vote: **${teamId.toUpperCase()}**`)
        .setColor(0x57F287);
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

      const changeCount = await incrementVoteChange(matchId, interaction.user.id);
      if (changeCount >= 3) {
        const config = await readTournamentConfig();
        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await interaction.client.channels.fetch(channelId);
        const drunkEmbed = new EmbedBuilder()
          .setDescription(`🍺 **${interaction.user}** ${pick(DRUNK_LINES)} *(${changeCount} vote changes on match #${matchId})*`)
          .setColor(0xE67E22);
        await channel.send({ embeds: [drunkEmbed] });
      }

      const minsUntilKickoff = (Date.parse(match.date) - Date.now()) / 60000;
      if (minsUntilKickoff <= 5 && minsUntilKickoff > 0) {
        const config = await readTournamentConfig();
        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await interaction.client.channels.fetch(channelId);
        const lateEmbed = new EmbedBuilder()
          .setDescription(`⏰ **${interaction.user}** ${pick(LAST_SEC_LINES)} *(match #${matchId})*`)
          .setColor(0xFEE75C);
        await channel.send({ embeds: [lateEmbed] });
      }
    } catch (err) {
      logger.error(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Something went wrong with your vote.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
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
        await interaction.reply({ content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }

    return;
  }
}
