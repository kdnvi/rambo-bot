import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { registerPlayer } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Đăng ký vào cuộc — có gan thì bấm');

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
        .setTitle('✅  Đăng ký thành công')
        .setDescription('Vào cuộc rồi! Gõ `/rank` xem BXH nha.')
        .setColor(0x57F287);
    } else {
      embed
        .setTitle('ℹ️  Đã đăng ký')
        .setDescription(result.message)
        .setColor(0xFEE75C);
    }

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Đăng ký lỗi rồi. Thử lại nha.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
