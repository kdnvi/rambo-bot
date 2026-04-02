import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('spam')
  .setDescription('Spam a specific user')
  .addUserOption(option => option.setName('user')
    .setDescription('User to spam')
    .setRequired(true));

export async function execute(interaction) {
  const user = interaction.options.get('user').user;

  const embed = new EmbedBuilder()
    .setTitle('📢  ATTENTION REQUIRED')
    .setDescription(`${user} `.repeat(20))
    .setColor(0xED4245)
    .setThumbnail(user.displayAvatarURL())
    .setFooter({ text: `Summoned by ${interaction.user.displayName}` });

  await interaction.reply({ embeds: [embed] });
}
