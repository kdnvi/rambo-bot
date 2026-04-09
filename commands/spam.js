import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { withErrorHandler } from '../utils/command.js';

const ALLOWED_USERS = new Set((process.env.AUDITED_USERS || '').split(',').filter(Boolean));

export const data = new SlashCommandBuilder()
  .setName('spam')
  .setDescription('Spam một người cho vui')
  .addUserOption(option => option.setName('user')
    .setDescription('Nạn nhân')
    .setRequired(true));

export const execute = withErrorHandler(async (interaction) => {
  if (!ALLOWED_USERS.has(interaction.user.id)) {
    await interaction.reply({ content: '❌ Bạn không có quyền xài lệnh này.', flags: MessageFlags.Ephemeral });
    return;
  }

  const user = interaction.options.get('user').user;

  const embed = new EmbedBuilder()
    .setTitle('📢  CHÚ Ý')
    .setDescription(`${user} `.repeat(20))
    .setColor(0xED4245)
    .setThumbnail(user.displayAvatarURL())
    .setFooter({ text: `${interaction.user.displayName} triệu hồi` });

  await interaction.reply({ embeds: [embed] });
});
