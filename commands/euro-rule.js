import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('euro-rule')
  .setDescription('Luật Euro 2024');

export async function execute(interaction) {
  await interaction.reply(`Luật chơi của Euro 2024 như sau:
- Bet sẽ được mở trước 1 ngày và sẽ được vote thông qua message của Rambo trên channel #euro2024.
- Mọi người được quyền vote bằng cách click button tương ứng, có thể thay đổi bằng cách click lựa chọn khác (không giới hạn cho đến khi trước giờ bóng lăn).
- Mỗi trận sẽ có Odds của mỗi trận được show trong message theo format home (đội nhà): \`4.5\` - draw (hoà): \`3\` - away (đội khách): \`0.5\` và sẽ mặc định là 10k cho tất cả.
- Số nhận lại được tính bằng cách 10 x odds + 10 (ví dụ: nếu chọn hoà thì nhận về 10 x 3 + 10 là 40, còn chọn đội khách thì nhận về 15).
- Tất cả tiền thua được đưa vào quỹ chung vì chúng ta không có cái. Nếu cuối mùa quỹ chung âm thì thu đều tất cả người chơi sau đó sẽ trả theo tổng tiền thắng của từng người, ngược lại thì sẽ chia đều cho tất cả người chơi.
- Những người chơi không vote trong thời gian quy định sẽ mặc định random vào nhóm bất kỳ.
- Kết quả sẽ chỉ được tính trong 90 phút + hiệp phụ (nếu có).
- Nếu đồng ý dùng command /euro-register để tham gia. GLHF!`);
}
