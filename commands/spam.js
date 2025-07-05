import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('spam')
  .setDescription('Spam a specific user')
  .addUserOption(option => option.setName('user')
    .setDescription('User to spam')
    .setRequired(true));

export async function execute(interaction) {
  const user = interaction.options.get('user').user;
  await interaction.reply(`${user} `.repeat(20));
}
