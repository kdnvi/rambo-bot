import logger from '../utils/logger.js';
import { Events, EmbedBuilder, MessageFlags } from 'discord.js';
import { updateMatchVote, readMatchVotes, readTournamentData, readPlayers, incrementVoteChange, readTournamentConfig, removePlayerWager, readUserWagers } from '../utils/firebase.js';
import { pick } from '../utils/helper.js';
import { handleRandomButton } from '../commands/random.js';

const DRUNK_LINES = [
  'chọn kiểu gì cũng không yên tâm... say hay sao? 🍺',
  'lật vote nhanh hơn lật bánh tráng 📺',
  'yêu đương còn không phân vân bằng trận này 💔',
  'mồ hôi tay ướt hết cả điện thoại 😰',
  'lại đổi vote NỮA. Vô đối chọn nhầm.',
  'trận này làm khủng hoảng cả tuổi thanh xuân 🌀',
  'đổi vote nhiều hơn đổi áo trong tuần 👔',
  'phân vân quá trời — chắc vote xong lại đổi tiếp 🔄',
  'hệ thống ghi nhận bạn là người hay thay đổi nhất 📝',
  'vote xong hối hận, hối hận xong vote lại. Vòng lặp vô tận ♾️',
  'bấm nút như đang chơi piano — nốt nào cũng bấm 🎹',
];

const LAST_SEC_LINES = [
  'chui vào vote phút 89! Tay run chân run. 💦',
  'suýt trễ! Ngủ nướng tới giờ này hả mậy? ⏰',
  'vote khi đồng hồ đếm ngược. Gan cùng mình. 🫣',
  'lách vào khe cửa hẹp. Pro hay hên? 🎰',
  'trọng tài sắp thổi còi mà mới chọn xong. Liều mạng! ⚡',
  'vote lúc cầu thủ đang ra sân. Kịch tính ghê. 🏃',
  'bóng sắp lăn mà tay vẫn còn run run bấm vote 😬',
  'chen vào giây cuối — kiểu người thích sống trên lằn ranh ⏱️',
  'deadline là động lực duy nhất. Vote xong thở phào 😮‍💨',
];

export const name = Events.InteractionCreate;
export async function execute(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('random-')) {
      return handleRandomButton(interaction);
    }

    const [matchIdStr, teamId] = interaction.customId.split('|');
    const matchId = parseInt(matchIdStr);

    try {
      const allMatches = (await readTournamentData('matches')).val();
      const match = allMatches?.find((m) => m.id === matchId);

      if (!match || Date.parse(match.date) < Date.now()) {
        const embed = new EmbedBuilder()
          .setDescription('⏰ Bóng lăn rồi — hết giờ vote!')
          .setColor(0xFEE75C);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      const players = (await readPlayers()).val();
      if (!players || !players[interaction.user.id]) {
        const embed = new EmbedBuilder()
          .setDescription('❌ `/register` đi rồi mới vote được nha.')
          .setColor(0xED4245);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      await updateMatchVote(matchId, interaction.user.id, teamId, interaction.message.id);

      const userWagers = await readUserWagers(interaction.user.id);
      if (userWagers[matchId]?.type === 'random') {
        await removePlayerWager(interaction.user.id, matchId);
      }

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

      const VOTE_SEPARATOR = '\n\n📊 ';
      const barText = `${match.home.toUpperCase()} ${hp}%  ·  Hoà ${dp}%  ·  ${match.away.toUpperCase()} ${ap}%`;

      const existingEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(existingEmbed)
        .setFooter({ text: `${voteCount} vote · Bấm bên dưới trước giờ đá!` });

      const baseDesc = (existingEmbed.description || '').split(VOTE_SEPARATOR)[0];
      updatedEmbed.setDescription(`${baseDesc}${VOTE_SEPARATOR}${barText}`);

      await interaction.update({ embeds: [updatedEmbed] });
      const embed = new EmbedBuilder()
        .setDescription(`✅ Vote của bạn: **${teamId.toUpperCase()}**`)
        .setColor(0x57F287);
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

      const changeCount = await incrementVoteChange(matchId, interaction.user.id);
      const minsUntilKickoff = (Date.parse(match.date) - Date.now()) / 60000;
      const needsChannel = changeCount >= 3 || (minsUntilKickoff <= 5 && minsUntilKickoff > 0);

      let channel = null;
      if (needsChannel) {
        const config = await readTournamentConfig();
        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        channel = await interaction.client.channels.fetch(channelId);
      }

      if (changeCount >= 3 && channel) {
        const drunkEmbed = new EmbedBuilder()
          .setDescription(`🍺 **${interaction.user}** ${pick(DRUNK_LINES)} *(${changeCount} lần đổi vote trận #${matchId})*`)
          .setColor(0xE67E22);
        await channel.send({ embeds: [drunkEmbed] });
      }

      if (minsUntilKickoff <= 5 && minsUntilKickoff > 0 && channel) {
        const lateEmbed = new EmbedBuilder()
          .setDescription(`⏰ **${interaction.user}** ${pick(LAST_SEC_LINES)} *(trận #${matchId})*`)
          .setColor(0xFEE75C);
        await channel.send({ embeds: [lateEmbed] });
      }
    } catch (err) {
      logger.error(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Có lỗi xảy ra với vote của bạn.', flags: MessageFlags.Ephemeral }).catch(() => {});
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
        await interaction.reply({ content: '❌ Có lỗi xảy ra.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }

    return;
  }
}
