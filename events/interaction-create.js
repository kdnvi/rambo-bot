import logger from '../utils/logger.js';
import { Events, EmbedBuilder, MessageFlags } from 'discord.js';
import { updateMatchVote, readMatchVotes, readTournamentData } from '../utils/firebase.js';

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

      const BAR_LEN = 16;
      const makeBar = (p) => {
        const filled = Math.round((p / 100) * BAR_LEN);
        return '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
      };
      const pad = 12;
      const barText = [
        `${match.home.toUpperCase().padEnd(pad)} ${makeBar(hp)}  ${String(hp).padStart(3)}%`,
        `${'Draw'.padEnd(pad)} ${makeBar(dp)}  ${String(dp).padStart(3)}%`,
        `${match.away.toUpperCase().padEnd(pad)} ${makeBar(ap)}  ${String(ap).padStart(3)}%`,
      ].join('\n');

      const existingEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(existingEmbed)
        .setFooter({ text: `${voteCount} vote(s) cast · Vote below before kickoff!` });

      const descParts = existingEmbed.description.split('\n```');
      const baseDesc = descParts[0];
      updatedEmbed.setDescription(`${baseDesc}\n\`\`\`\n${barText}\n\`\`\``);

      await interaction.update({ embeds: [updatedEmbed] });
      const embed = new EmbedBuilder()
        .setDescription(`✅ Your vote: **${teamId.toUpperCase()}**`)
        .setColor(0x57F287);
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
