import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { registerPlayer } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Join the current tournament');

export async function execute(interaction) {
  try {
    const result = await registerPlayer(interaction.user.id);

    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.displayName,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTimestamp();

    if (result.success) {
      embed
        .setTitle('✅  Registration Complete')
        .setDescription('You have joined the tournament! Use `/rank` to see the leaderboard.')
        .setColor(0x57F287);
    } else {
      embed
        .setTitle('ℹ️  Already Registered')
        .setDescription(result.message)
        .setColor(0xFEE75C);
    }

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Registration failed. Please try again later.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
