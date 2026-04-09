import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('spam')
  .setDescription('Spam một người cho vui')
  .addUserOption(option => option.setName('user')
    .setDescription('Nạn nhân')
    .setRequired(true));

export async function execute(interaction) {
  try {
    const user = interaction.options.get('user').user;

    const embed = new EmbedBuilder()
      .setTitle('📢  CHÚ Ý')
      .setDescription(`${user} `.repeat(20))
      .setColor(0xED4245)
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ text: `${interaction.user.displayName} triệu hồi` });

    await interaction.reply({ embeds: [embed] });
  } catch {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Đã xảy ra lỗi.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
