import logger from '../utils/logger.js';
import { Events, EmbedBuilder } from 'discord.js';
import { updateMatchVote, readMatchVotes } from '../utils/firebase.js';

export const name = Events.InteractionCreate;
export async function execute(interaction) {
  if (interaction.isButton()) {
    const [teamId, matchId, date] = interaction.customId.split('_');

    try {
      if (Date.parse(date) < Date.now()) {
        const embed = new EmbedBuilder()
          .setDescription('⏰ This match has already started — voting is closed.')
          .setColor(0xFEE75C);
        interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      await updateMatchVote(matchId, interaction.user.id, teamId, interaction.message.id);
      const users = interaction.client.cachedUsers;
      const votes = (await readMatchVotes(matchId, interaction.message.id)).val();

      const members = [];
      for (const [key] of Object.entries(votes)) {
        members.push(users[key]?.nickname || 'Unknown');
      }

      const names = members.join(', ');
      interaction.update({
        content: `🗳️ **Voted (${members.length}):** ${names}`,
      });
    } catch (err) {
      logger.error(err);
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
    }

    return;
  }
}
