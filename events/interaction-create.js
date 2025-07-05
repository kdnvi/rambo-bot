import logger from '../utils/logger.js';
import { ComponentType, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { updateEuroMatchVote, readOnceEuroMatchVotes } from '../utils/firebase.js';

export const name = Events.InteractionCreate;
export async function execute(interaction) {
  if (interaction.isButton()) {
    const [teamId, matchId, date] = interaction.customId.split('_');

    try {
      if (Date.parse(date) < Date.now()) {
        interaction.reply('This match is not available anymore!');
        return;
      }

      await updateEuroMatchVote(matchId, interaction.user.id, teamId, interaction.message.id);
      const users = interaction.client.cachedUsers;
      const votes = (await readOnceEuroMatchVotes(matchId, interaction.message.id)).val();

      const members = [];
      for (const [key, _] of Object.entries(votes)) {
        members.push(users[key].nickname);
      }

      const names = members.join(', ');
      interaction.update({
        content: `Voted: ${names}`,
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
