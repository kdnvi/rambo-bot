import { Events } from 'discord.js';

const REPLY_LINES = [
  'Ơi, gọi gì đó? 👀',
  'Nói gì thì nói, vote chưa? 🤔',
  'Tag tui hoài, vote thì không chịu vote.',
  'Bận tính điểm, nói nhanh đi.',
  'Tui là bot, không phải therapist nha.',
  'Gọi Rambo mà không vote là phạm tội đó.',
  'Có gì gấp không? Tui đang đếm tiền... à, đếm điểm.',
  'Lại réo tên. Chắc muốn bị random vote.',
  'Nghe nè, nhưng tui chỉ hiểu ngôn ngữ bóng đá thôi. ⚽',
  'Reply làm chi, gõ `/rank` xem mình đứng đâu đi.',
  'Alo? Rambo đây. Chuyện gì cũng quy về bóng đá nha.',
  'Đọc tin nhắn rồi, nhưng tui không có cảm xúc. 🤖',
  'Tui thấy hết á. Vote đi rồi nói chuyện.',
  'Khỏi kể lể, `/stats` tự nói lên tất cả.',
  'Reply Rambo mà không double-down thì phí lắm.',
  'Dạ có mặt! Nhưng mà vote trước nha, ưu tiên. 🫡',
  'Rambo nghe đây — nhưng nếu chưa vote thì đừng nói gì hết.',
  'Chào bạn! Nhắc nhẹ: đoán sai không phải lỗi của Rambo nha.',
  'Ủa gọi tui? Tưởng gọi thầy bùa chứ. 🧿',
  'Nói nhanh đi, trận tới sắp đá rồi. ⏰',
];

const MENTION_LINES = [
  'Ê, tui là bot bóng đá, không phải Google nha. ⚽',
  'Tag Rambo để hỏi chuyện đời? Sai số rồi bạn ơi.',
  'Tui chỉ biết bóng đá thôi. Chuyện khác hỏi Siri đi.',
  'Không liên quan bóng đá thì Rambo không quan tâm. 🙃',
  'Bạn đang nói gì? Rambo chỉ nghe từ "vote", "goal", "win".',
  'Ngoài bóng đá ra thì Rambo mù tịt. Hỏi chi vậy?',
  'Rambo không có chức năng tâm sự. Chỉ có chức năng tính điểm. 🤖',
  'Ơ, đây là kênh bóng đá mà. Nói chuyện bóng đi!',
  'Tin nhắn này không chứa từ khoá bóng đá. Rambo bỏ qua. 🚫',
  'Hỏi Rambo chuyện ngoài bóng đá giống hỏi cá leo cây vậy. 🐟',
  'Rambo đã đọc. Rambo không hiểu. Rambo đi tính điểm tiếp.',
  'Bạn tag nhầm bot rồi. Rambo chỉ sống vì bóng đá thôi.',
  'Câu này hay, nhưng nó không giúp bạn lên hạng đâu.',
  'Rambo ghi nhận. Nhưng mà ghi nhận xong thì quên liền. 🧠',
  'Đừng làm phiền Rambo khi không có trận đấu nha. 😤',
  'Tag tui vì chuyện không liên quan? Trừ điểm social credit. 📉',
  'Chuyện này nằm ngoài phạm vi hiểu biết của Rambo. Bye. 👋',
  'Rambo xin phép không trả lời vì... không liên quan. ⚽',
  'Nếu không phải bóng đá thì Rambo sẽ giả vờ không thấy. 🫣',
  'Alo, Rambo nè. Nói chuyện bóng đá thôi, cảm ơn. 📞',
];

const REPLY_CHANCE = 0.5;

export const name = Events.MessageCreate;
export async function execute(message) {
  if (message.author.bot) return;

  const botId = message.client.user.id;
  const isMentioned = message.mentions.has(botId) && !message.reference;
  const isReply = !!message.reference;

  if (!isMentioned && !isReply) return;

  try {
    if (isMentioned) {
      const line = MENTION_LINES[Math.floor(Math.random() * MENTION_LINES.length)];
      await message.reply(line);
      return;
    }

    const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
    if (repliedTo.author.id !== botId) return;

    if (Math.random() > REPLY_CHANCE) return;

    const line = REPLY_LINES[Math.floor(Math.random() * REPLY_LINES.length)];
    await message.reply(line);
  } catch {
    // silently ignore fetch failures
  }
}
